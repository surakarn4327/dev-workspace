using System.Text;
using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Protocol;

namespace PcControllerAgent;

// Thin wrapper over MQTTnet: connects to the public broker, keeps reconnecting,
// and hands raw message text to the core (which decrypts/validates it).
public sealed class MqttBridge : IDisposable
{
    public const string Host = "broker.emqx.io";
    public const int Port = 8883;

    readonly Func<AppConfig> _cfg;
    readonly IMqttClient _client;
    readonly CancellationTokenSource _cts = new();

    public event Action<bool>? ConnectionChanged;
    // kind is "cmd" or "cfg"
    public event Action<string, string>? MessageReceived;

    public bool IsConnected => _client.IsConnected;

    public MqttBridge(Func<AppConfig> cfg)
    {
        _cfg = cfg;
        _client = new MqttFactory().CreateMqttClient();
        _client.DisconnectedAsync += _ =>
        {
            ConnectionChanged?.Invoke(false);
            return Task.CompletedTask;
        };
        _client.ApplicationMessageReceivedAsync += e =>
        {
            var t = Topics(_cfg().AgentId);
            string text = Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment);
            if (e.ApplicationMessage.Topic == t.Cmd) MessageReceived?.Invoke("cmd", text);
            else if (e.ApplicationMessage.Topic == t.Cfg) MessageReceived?.Invoke("cfg", text);
            return Task.CompletedTask;
        };
    }

    public static (string Base, string Availability, string State, string Cmd, string Cfg) Topics(string agentId)
    {
        string b = $"pc-controller/agent-{agentId}";
        return (b, $"{b}/availability", $"{b}/state", $"{b}/cmd", $"{b}/cfg");
    }

    public void Start() => _ = Task.Run(LoopAsync);

    async Task LoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                if (!_client.IsConnected) await ConnectAsync();
            }
            catch
            {
                // Retry on the next tick; the UI shows "not connected".
            }
            try { await Task.Delay(5000, _cts.Token); } catch (OperationCanceledException) { }
        }
    }

    async Task ConnectAsync()
    {
        var t = Topics(_cfg().AgentId);
        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(Host, Port)
            .WithTlsOptions(o => o.UseTls())
            .WithClientId($"agent-{_cfg().AgentId}-{AppConfig.RandomHex(3)}")
            .WithWillTopic(t.Availability)
            .WithWillPayload("offline")
            .WithWillRetain(true)
            .WithWillQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
            .WithKeepAlivePeriod(TimeSpan.FromSeconds(30))
            .WithCleanSession()
            .Build();

        await _client.ConnectAsync(options, _cts.Token);
        await _client.SubscribeAsync(new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(t.Cmd, MqttQualityOfServiceLevel.AtLeastOnce)
            .WithTopicFilter(t.Cfg, MqttQualityOfServiceLevel.AtLeastOnce)
            .Build(), _cts.Token);
        await PublishAsync(t.Availability, "online", retain: true);
        ConnectionChanged?.Invoke(true);
    }

    public async Task PublishAsync(string topic, string payload, bool retain = false)
    {
        if (!_client.IsConnected) return;
        try
        {
            await _client.PublishStringAsync(topic, payload, MqttQualityOfServiceLevel.AtLeastOnce, retain);
        }
        catch
        {
            // Connection dropped mid-publish; the next reconnect republishes state.
        }
    }

    // Drops the connection; the loop reconnects within a few seconds using
    // whatever agent ID the config has by then.
    public async Task DisconnectAsync()
    {
        try { await _client.DisconnectAsync(); } catch { }
    }

    // Tells the broker we're going away on purpose (the will message only
    // fires on an unclean disconnect).
    public async Task GoOfflineAsync()
    {
        if (!_client.IsConnected) return;
        await PublishAsync(Topics(_cfg().AgentId).Availability, "offline", retain: true);
        try { await _client.DisconnectAsync(); } catch { }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _client.Dispose();
    }
}
