import mqtt from 'mqtt';
const c = mqtt.connect('mqtts://broker.emqx.io:8883', { clientId: 'peek-' + Math.random().toString(16).slice(2) });
c.on('connect', () => c.subscribe(['pc-controller/pc-92bbbc2c/sched','pc-controller/pc-92bbbc2c/status','pc-controller/pc-92bbbc2c/availability']));
c.on('message', (t, p, pk) => console.log(t.split('/').pop(), pk.retain ? '(retained)' : '', p.toString()));
setTimeout(() => c.end(), 5000);

