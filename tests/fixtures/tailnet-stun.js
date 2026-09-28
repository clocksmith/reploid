// Test-only IPv4 STUN binding responder. Bind to an explicitly selected private
// interface; exits on its configured lease. No relay, credentials or discovery.
import dgram from 'node:dgram';
const [host, portText, leaseText] = process.argv.slice(2), port=Number(portText),lease=Number(leaseText);
if (!host || !Number.isInteger(port)||port<1024||port>65535||!Number.isSafeInteger(lease)||lease<1) throw Error('Host, unprivileged port and lease milliseconds required');
const socket=dgram.createSocket('udp4');
socket.on('message',(input,peer)=>{
 if(input.length<20||input.readUInt16BE(0)!==1||input.readUInt32BE(4)!==0x2112a442||input.readUInt16BE(2)!==input.length-20)return;
 const ip=peer.address.split('.').map(Number);if(ip.length!==4)return;
 const out=Buffer.alloc(32);out.writeUInt16BE(0x0101,0);out.writeUInt16BE(12,2);input.copy(out,4,4,20);
 out.writeUInt16BE(0x0020,20);out.writeUInt16BE(8,22);out[25]=1;out.writeUInt16BE(peer.port^0x2112,26);
 const magic=[0x21,0x12,0xa4,0x42];for(let i=0;i<4;i++)out[28+i]=ip[i]^magic[i];socket.send(out,peer.port,peer.address);
});
socket.bind(port,host,()=>console.log('STUN binding fixture ready'));
setTimeout(()=>socket.close(),lease);
