using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PcControllerAgent;

// AES-256-GCM envelope shared with the phone app (src/crypto.ts). Wire format:
// {"n": base64(12-byte nonce), "c": base64(ciphertext || 16-byte tag)}.
// The key is derived from the pairing code (see Pairing.cs); the AAD ("state" or "cmd") binds a
// message to its direction so captured state can't be replayed as a command.
public static class Envelope
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Seal(byte[] key, string direction, object payload)
    {
        byte[] plain = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        byte[] nonce = RandomNumberGenerator.GetBytes(12);
        byte[] cipher = new byte[plain.Length];
        byte[] tag = new byte[16];
        using var aes = new AesGcm(key, 16);
        aes.Encrypt(nonce, plain, cipher, tag, Encoding.UTF8.GetBytes(direction));
        return JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["n"] = Convert.ToBase64String(nonce),
            ["c"] = Convert.ToBase64String(cipher.Concat(tag).ToArray()),
        });
    }

    // Null for anything that doesn't authenticate with this key.
    public static JsonElement? Open(byte[] key, string direction, string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            byte[] nonce = Convert.FromBase64String(doc.RootElement.GetProperty("n").GetString()!);
            byte[] all = Convert.FromBase64String(doc.RootElement.GetProperty("c").GetString()!);
            if (nonce.Length != 12 || all.Length < 16) return null;
            byte[] cipher = all[..^16];
            byte[] tag = all[^16..];
            byte[] plain = new byte[cipher.Length];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, cipher, tag, plain, Encoding.UTF8.GetBytes(direction));
            return JsonDocument.Parse(plain).RootElement.Clone();
        }
        catch
        {
            return null;
        }
    }
}
