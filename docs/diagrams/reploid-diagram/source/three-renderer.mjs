/** Optional Three.js geometry layer. Labels remain accessible SVG text. */
import * as THREE from '../vendor/three/three.module.js';
import { edgePoints, arrowPoints, diagramTheme } from './core.mjs';

export class ThreeDiagramRenderer {
  constructor(host,{onContextLost=()=>{}}={}) {
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    this.renderer.setClearColor(0x000000,0);
    this.renderer.domElement.className='three-layer';
    this.renderer.domElement.setAttribute('aria-hidden','true');
    this.lost=e=>{e.preventDefault();onContextLost();};
    this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
    host.prepend(this.renderer.domElement);
    this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(0,1,0,1,.1,100);
    this.camera.position.z=50;
  }
  clear(){
    for(const object of [...this.scene.children]) {
      object.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});
      this.scene.remove(object);
    }
  }
  polygon(points,color,z=0){
    const shape=new THREE.Shape();points.forEach((p,i)=>i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y));shape.closePath();
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));mesh.position.z=z;this.scene.add(mesh);return mesh;
  }
  rect(x,y,w,h,r,color,z=1){
    const s=new THREE.Shape();
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(s,12),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));mesh.position.z=z;this.scene.add(mesh);
  }
  shadow(n){
    const pad=55,scale=2,c=document.createElement('canvas');c.width=(n.width+pad*2)*scale;c.height=(n.height+pad*2)*scale;
    const ctx=c.getContext('2d');ctx.scale(scale,scale);
    for(const [x,y,color,blur] of [[8,10,'rgba(0,0,0,.12)',15],[-7,-7,'rgba(255,255,255,.90)',13]]) {
      ctx.shadowOffsetX=x*scale;ctx.shadowOffsetY=y*scale;ctx.shadowBlur=blur*scale;ctx.shadowColor=color;ctx.fillStyle='#eeeeee';ctx.beginPath();ctx.roundRect(pad,pad,n.width,n.height,24);ctx.fill();
    }
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(n.width+pad*2,n.height+pad*2),mat);mesh.rotation.x=Math.PI;mesh.position.set(n.x+n.width/2,n.y+n.height/2,0);this.scene.add(mesh);
  }
  segment(a,b,width,color,stroke='solid',z=.5){
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)return;
    const ux=dx/len,uy=dy/len,perpx=-uy*width/2,perpy=ux*width/2;
    const dash=stroke==='solid'?len:stroke==='dashed'?9:2,gap=stroke==='solid'?0:6;
    for(let start=0;start<len;start+=dash+gap){const end=Math.min(start+dash,len),p={x:a.x+ux*start,y:a.y+uy*start},q={x:a.x+ux*end,y:a.y+uy*end};this.polygon([{x:p.x+perpx,y:p.y+perpy},{x:q.x+perpx,y:q.y+perpy},{x:q.x-perpx,y:q.y-perpy},{x:p.x-perpx,y:p.y-perpy}],color,z);}
  }
  draw(doc,view,transform,width,height,selected){
    this.clear();const T=diagramTheme(doc);
    this.renderer.setSize(width,height,false);
    Object.assign(this.camera,{left:-transform.x/transform.z,right:(width-transform.x)/transform.z,top:-transform.y/transform.z,bottom:(height-transform.y)/transform.z});this.camera.updateProjectionMatrix();
    if(view.kind==='sequence')for(const n of view.nodes)this.segment({x:n.x+n.width/2,y:n.y+n.height+10},{x:n.x+n.width/2,y:view.lifelineEnd},1.2,'#999999','dotted');
    for(const b of view.bands??[])this.segment({x:25,y:b.y},{x:view.width-25,y:b.y},1,T.border);
    for(const e of view.edges){const points=edgePoints(view,e),style=doc.edgeTypes[e.type],col=selected===e.id?T.text:T.line;for(let i=1;i<points.length;i++)this.segment(points[i-1],points[i],style.width,col,style.stroke);if(style.arrow!=='none')this.polygon(arrowPoints(points.at(-1),points.at(-2)),col,.6);if(style.arrow==='both')this.polygon(arrowPoints(points[0],points[1]),col,.6);}
    for(const n of view.nodes){const r=view.kind==='sequence'?17:24;this.shadow(n);this.rect(n.x,n.y,n.width,n.height,r,selected===n.id?T.line:T.border,1);this.rect(n.x+1,n.y+1,n.width-2,n.height-2,r-1,T.surface,1.1);}
    this.renderer.render(this.scene,this.camera);
  }
  dispose(){this.clear();this.renderer.domElement.removeEventListener('webglcontextlost',this.lost);this.renderer.dispose();this.renderer.domElement.remove();}
}
