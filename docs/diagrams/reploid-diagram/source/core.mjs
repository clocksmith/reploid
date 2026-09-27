/** Renderer-independent validation, edge routing and SVG serialization. */
const NS = 'http://www.w3.org/2000/svg';
const fail = message => { throw new TypeError(message); };
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const finite = n => Number.isFinite(n) && Math.abs(n) <= 100000;
const string = (s,max=2000) => typeof s === 'string' && s.length <= max;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function validateDocument(input) {
  if (!input || input.format !== 'box-arrow-diagram/v1') fail('Expected format: box-arrow-diagram/v1.');
  if (!string(input.title,180)) fail('The document needs a short title.');
  if (!Array.isArray(input.views) || !input.views.length || input.views.length>20) fail('Expected 1–20 views.');
  if (!input.edgeTypes || typeof input.edgeTypes !== 'object' || Array.isArray(input.edgeTypes)) fail('Missing edgeTypes.');
  for (const [key,t] of Object.entries(input.edgeTypes)) {
    if (!t || !['solid','dashed','dotted'].includes(t.stroke) || !['none','target','both'].includes(t.arrow)) fail(`Invalid edge style: ${key}.`);
    if (!Number.isFinite(t.width) || t.width<=0 || t.width>8 || !string(t.label,100)) fail(`Invalid edge width or label: ${key}.`);
  }
  if (input.theme) for (const [key,value] of Object.entries(input.theme)) {
    if (!/^#[\da-f]{6}$/i.test(value)) fail(`Theme ${key} must be a six-digit hex color.`);
  }
  const viewIds=new Set();
  for (const view of input.views) {
    if (!view || !string(view.id,100) || !view.id || viewIds.has(view.id)) fail('Invalid or duplicate view id.');
    viewIds.add(view.id);
    if (!['graph','sequence'].includes(view.kind)) fail(`Unknown view kind: ${view.kind}.`);
    if (![view.width,view.height].every(n=>finite(n)&&n>0)) fail(`Invalid view size: ${view.id}.`);
    if (!string(view.title,160)||!string(view.subtitle??'',1000)) fail('Invalid view text.');
    if (!Array.isArray(view.references??[])||(view.references??[]).length>20) fail('Invalid view references.');
    for (const reference of view.references??[]) {
      if (!reference||!string(reference.label,180)||!reference.label||!string(reference.url,2000)
        ||!['intent','implementation','evidence'].includes(reference.kind)) fail('Invalid contract reference.');
      let url;
      try { url=new URL(reference.url); } catch { fail('Contract references require an absolute HTTPS URL.'); }
      if (url.protocol!=='https:'||url.username||url.password) fail('Contract references require an absolute HTTPS URL without credentials.');
    }
    if (!Array.isArray(view.nodes)||!Array.isArray(view.edges)||view.nodes.length>500||view.edges.length>2000) fail('Too many or missing nodes/edges.');
    const ids=new Set();
    for (const n of view.nodes) {
      if (!n || !string(n.id,100)||!n.id||ids.has(n.id)) fail(`Invalid or duplicate node id in ${view.id}.`);
      ids.add(n.id);
      if (![n.x,n.y,n.width,n.height].every(finite)||n.width<60||n.height<40) fail(`Invalid bounds for ${n.id}.`);
      if (!string(n.label,180)||!string(n.subtitle??'',500)||!string(n.footnote??'',500)||!Array.isArray(n.body??[])||(n.body??[]).length>12||(n.body??[]).some(t=>!string(t,600))) fail(`Invalid text for ${n.id}.`);
    }
    const eids=new Set();
    for(const e of view.edges) {
      if (!e||!string(e.id,100)||!e.id||eids.has(e.id)) fail(`Duplicate or invalid edge in ${view.id}.`);
      eids.add(e.id);
      if (!ids.has(e.source)||!ids.has(e.target)||e.source===e.target||!own(input.edgeTypes,e.type)) fail(`Unknown endpoint or style on edge ${e.id}.`);
      if (!string(e.label,1000)||!Array.isArray(e.details??[])||(e.details??[]).some(t=>!string(t,5000))) fail(`Invalid edge text ${e.id}.`);
      if (view.kind==='sequence'&&!finite(e.y)) fail(`Missing message y on ${e.id}.`);
      for(const a of [e.sourceAnchor,e.targetAnchor].filter(Boolean)) if (!['left','right','top','bottom'].includes(a.side)||!Number.isFinite(a.offset)||a.offset<0||a.offset>1) fail(`Invalid anchor on ${e.id}.`);
      if(e.labelPosition&&![e.labelPosition.x,e.labelPosition.y].every(finite)) fail(`Invalid label position on ${e.id}.`);
      if(e.labelWidth!==undefined&&(!finite(e.labelWidth)||e.labelWidth<=0)) fail(`Invalid label width on ${e.id}.`);
      if(e.waypoints&&(!Array.isArray(e.waypoints)||e.waypoints.length>40||e.waypoints.some(p=>!p||![p.x,p.y].every(finite)))) fail(`Invalid waypoints on ${e.id}.`);
    }
    for(const item of view.notes??[]) if (![item.x,item.y,item.width,item.height].every(finite)||item.width<=0||item.height<=0||!string(item.label,200)||!string(item.text,1000)) fail('Invalid note.');
    for(const b of view.bands??[]) if (!finite(b.y)||!string(b.label,400)) fail('Invalid sequence band.');
    if(view.kind==='sequence'&&(!finite(view.lifelineEnd)||view.lifelineEnd<0)) fail('Missing sequence lifelineEnd.');
    for(const k of view.legend??[]) if(!own(input.edgeTypes,k)) fail('Unknown legend style.');
  }
  if(input.defaultView&&!viewIds.has(input.defaultView)) fail('Unknown defaultView.');
  if(!Array.isArray(input.entities??[])||(input.entities??[]).length>1000) fail('Invalid entity registry.');
  return structuredClone(input);
}

export function anchor(n,a={side:'right',offset:.5}) {
  if(a.side==='left')return {x:n.x,y:n.y+n.height*a.offset};
  if(a.side==='right')return {x:n.x+n.width,y:n.y+n.height*a.offset};
  if(a.side==='top')return {x:n.x+n.width*a.offset,y:n.y};
  return {x:n.x+n.width*a.offset,y:n.y+n.height};
}
export function edgePoints(view,e) {
  const s=view.nodes.find(n=>n.id===e.source),t=view.nodes.find(n=>n.id===e.target);
  if(view.kind==='sequence') return [{x:s.x+s.width/2,y:e.y},{x:t.x+t.width/2,y:e.y}];
  const from=anchor(s,e.sourceAnchor??{side:'right',offset:.5}),to=anchor(t,e.targetAnchor??{side:'left',offset:.5});
  if(e.waypoints?.length)return [from,...e.waypoints,to];
  if(Math.abs(from.y-to.y)<.5||Math.abs(from.x-to.x)<.5)return [from,to];
  const mid=(from.x+to.x)/2;
  return [from,{x:mid,y:from.y},{x:mid,y:to.y},to];
}
export function arrowPoints(tip,prev,size=11) {
  const dx=tip.x-prev.x,dy=tip.y-prev.y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
  return [tip,{x:tip.x-ux*size-uy*size*.48,y:tip.y-uy*size+ux*size*.48},{x:tip.x-ux*size+uy*size*.48,y:tip.y-uy*size-ux*size*.48}];
}
export const dashPattern = type => type.stroke==='dashed'?'9 6':type.stroke==='dotted'?'2 6':'';
export function diagramTheme(doc) {return {background:'#e9e9e9',surface:'#eeeeee',text:'#202020',muted:'#646464',line:'#373737',border:'#cccccc',...doc.theme};}
const lines = value => String(value??'').split('\n');
function wrap(value, chars) {
  const out=[];
  for(const line of lines(value)) {
    let row='';
    for(const word of line.split(' ')) {if(row&&(row+' '+word).length>chars) {out.push(row);row=word;}else row+=(row?' ':'')+word;}
    out.push(row);
  }
  return out;
}
function textBlock(text,x,y,{size=16,weight=400,fill='#202020',anchor='start',width=null,lineHeight=size*1.45}={}) {
  const rows=width?wrap(text,Math.max(12,Math.floor(width/(size*.51)))):lines(text);
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${rows.map((s,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${esc(s)}</tspan>`).join('')}</text>`;
}
export function svgContents(doc,view,{geometry=true,selected=null}={}) {
  const T=diagramTheme(doc);let out='';
  out+=`<defs><filter id="soft" x="-25%" y="-35%" width="155%" height="180%"><feDropShadow dx="8" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.10"/><feDropShadow dx="-7" dy="-7" stdDeviation="10" flood-color="#ffffff" flood-opacity="0.88"/></filter></defs>`;
  if(view.kind==='sequence') {
    for(const n of view.nodes){const x=n.x+n.width/2;out+=`<path d="M${x},${n.y+n.height+10} V${view.lifelineEnd}" fill="none" stroke="${geometry?'#999999':'none'}" stroke-width="1.2" stroke-dasharray="4 7"/>`;}
    for(const b of view.bands??[])out+=`<path d="M25,${b.y} H${view.width-25}" stroke="${geometry?T.border:'none'}"/>`+textBlock(b.label,30,b.y-12,{size:12,weight:600,fill:T.muted});
  }
  for(const e of view.edges) {
    const p=edgePoints(view,e),type=doc.edgeTypes[e.type],d=p.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' '),color=selected===e.id?T.text:T.line;
    out+=`<g data-edge="${esc(e.id)}" tabindex="0" role="button" aria-label="${esc(e.label)}"><path d="${d}" fill="none" stroke="${geometry?color:'none'}" stroke-width="${type.width}" ${dashPattern(type)?`stroke-dasharray="${dashPattern(type)}"`:''}/><path d="${d}" fill="none" stroke="transparent" stroke-width="22"/>`;
    if(geometry&&type.arrow!=='none')out+=`<polygon points="${arrowPoints(p.at(-1),p.at(-2)).map(p=>`${p.x},${p.y}`).join(' ')}" fill="${color}"/>`;
    if(geometry&&type.arrow==='both')out+=`<polygon points="${arrowPoints(p[0],p[1]).map(p=>`${p.x},${p.y}`).join(' ')}" fill="${color}"/>`;
    const lp=e.labelPosition??{x:(p[0].x+p.at(-1).x)/2,y:(p[0].y+p.at(-1).y)/2};
    const sz=view.kind==='sequence'?15:16,wrapped=wrap(e.label,Math.floor((e.labelWidth??190)/(sz*.51))),h=wrapped.length*sz*1.45+16;
    if(view.kind==='graph')out+=`<rect x="${lp.x-(e.labelWidth??190)/2}" y="${lp.y-h/2}" width="${e.labelWidth??190}" height="${h}" rx="9" fill="${T.background}"/>`;
    out+=textBlock(wrapped.join('\n'),lp.x,view.kind==='sequence'?lp.y:lp.y-(wrapped.length-1)*sz*.725+sz*.32,{size:sz,fill:color,anchor:'middle'})+'</g>';
  }
  for(const n of view.nodes) {
    const small=view.kind==='sequence',pad=small?18:24;
    out+=`<g data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.label)}: ${esc(n.subtitle)}" style="cursor:grab">`;
    out+=`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${small?17:24}" fill="${geometry?T.surface:'transparent'}" stroke="${geometry?(selected===n.id?T.line:T.border):'transparent'}" stroke-width="${selected===n.id?1.7:.8}" ${geometry?'filter="url(#soft)"':''}/>`;
    if(!small)out+=textBlock(n.entity??n.id,n.x+pad,n.y+31,{size:12,weight:600,fill:T.muted});
    out+=textBlock(n.label,n.x+pad,n.y+(small?36:71),{size:small?22:29,weight:600,fill:T.text});
    out+=textBlock(n.subtitle??'',n.x+pad,n.y+(small?65:102),{size:small?14:16,fill:T.muted});
    if((n.body??[]).length){out+=`<path d="M${n.x+pad},${n.y+124} H${n.x+n.width-pad}" stroke="${T.border}" stroke-width=".8"/>`;n.body.forEach((b,i)=>{out+=textBlock(b,n.x+pad,n.y+153+i*29,{size:15,fill:T.text});});}
    if(n.footnote)out+=textBlock(n.footnote,n.x+pad,n.y+n.height-27,{size:13,fill:T.muted,width:n.width-pad*2});
    out+='</g>';
  }
  for(const n of view.notes??[]) {
    out+=textBlock(n.label,n.x+n.width/2,n.y+22,{size:18,weight:600,anchor:'middle',fill:T.text});
    out+=textBlock(n.text,n.x+n.width/2,n.y+49,{size:14,anchor:'middle',fill:T.muted,width:n.width});
  }
  return out;
}
export function exportSVG(doc,view) {
 const T=diagramTheme(doc);
 return `<svg xmlns="${NS}" viewBox="0 0 ${view.width} ${view.height}" width="${view.width}" height="${view.height}" font-family="Arial, Helvetica, sans-serif"><title>${esc(doc.title)} — ${esc(view.title)}</title><desc>${esc(view.subtitle)} Intended architecture, not proof of implementation.</desc><rect width="100%" height="100%" fill="${T.background}"/>${textBlock(doc.title,48,48,{size:27,weight:600})}${textBlock(view.subtitle,48,79,{size:15,fill:T.muted})}${svgContents(doc,view)}</svg>`;
}
