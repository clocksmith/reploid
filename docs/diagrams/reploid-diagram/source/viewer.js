/** Plain DOM editor. JSON is always parsed as data; never evaluated as JavaScript. */
(() => {
  const $=s=>document.querySelector(s),stage=$('#stage'),svg=$('#diagram'),group=$('#world');
  let doc=validateDocument(JSON.parse($('#diagram-data').textContent));
  let activeView=doc.defaultView??doc.views[0].id,selected=null,gpu=null,engine='svg';
  let transform={x:0,y:0,z:1},scheduled=false,pointer=null,disposed=false;
  const view=()=>doc.views.find(v=>v.id===activeView),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function toast(message){$('#status').textContent=message;}
  function requestDraw(){if(scheduled||disposed)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;draw();});}
  function draw(){
    const w=stage.clientWidth,h=stage.clientHeight;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);group.setAttribute('transform',`translate(${transform.x} ${transform.y}) scale(${transform.z})`);
    group.innerHTML=svgContents(doc,view(),{geometry:!gpu,selected});
    if(gpu){try{gpu.draw(doc,view(),transform,w,h,selected);}catch(error){useSVG();toast(`Three.js stopped: ${error.message}. SVG remains available.`);return;}}
    $('#zoom-label').textContent=Math.round(transform.z*100)+'%';
    $('#engine').textContent=gpu?'Three.js':'SVG';$('#engine').title=gpu?'Switch to SVG':'Use locally installed Three.js';
    $('#stage').dataset.engine=gpu?'three':'svg';
  }
  function fit(){
    const v=view(),w=stage.clientWidth,h=stage.clientHeight;
    transform.z=clamp(Math.min((w-64)/v.width,(h-30)/v.height),.18,1.35);
    transform.x=(w-v.width*transform.z)/2;transform.y=(h-v.height*transform.z)/2;requestDraw();
  }
  function setView(id){
    if(!doc.views.some(v=>v.id===id))return;
    activeView=id;selected=null;$('#details').hidden=true;$('#details-toggle').setAttribute('aria-expanded','false');
    renderChrome();fit();
  }
  function renderChrome(){
    const T=diagramTheme(doc);for(const [k,v]of Object.entries(T))document.documentElement.style.setProperty('--'+k,v);
    $('#document-title').textContent=doc.title;
    $('#view-description').textContent=view().subtitle;
    $('#tabs').replaceChildren(...doc.views.map(v=>{const b=document.createElement('button');b.textContent=v.title;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(v.id===activeView));b.addEventListener('click',()=>setView(v.id));return b;}));
    const legend=$('#legend');legend.replaceChildren();
    for(const k of view().legend??[]){const t=doc.edgeTypes[k],span=document.createElement('span'),sample=document.createElementNS('http://www.w3.org/2000/svg','svg');sample.setAttribute('viewBox','0 0 58 18');sample.setAttribute('aria-hidden','true');
      sample.innerHTML=`<path d="M3 9 H51" stroke="currentColor" stroke-width="1.5" ${dashPattern(t)?`stroke-dasharray="${dashPattern(t)}"`:''}/>${t.arrow!=='none'?'<path d="M51 5 L57 9 L51 13 Z" fill="currentColor"/>':''}`;
      span.append(sample,document.createTextNode(t.label));legend.append(span);
    }
  }
  function text(parent,tag,content){const e=document.createElement(tag);e.textContent=content;parent.append(e);return e;}
  function inspect(id,isEdge=false){
    selected=id;const panel=$('#details-content');panel.replaceChildren();
    const item=isEdge?view().edges.find(e=>e.id===id):view().nodes.find(n=>n.id===id);
    if(!item)return;
    text(panel,'small',isEdge?doc.edgeTypes[item.type].label:'PACKAGE RESPONSIBILITY');
    text(panel,'h2',isEdge?`${item.source} ${doc.edgeTypes[item.type].arrow==='none'?'—':'→'} ${item.target}`:item.label);
    if(isEdge){text(panel,'p',item.label.replace(/\n/g,' / '));for(const d of item.details??[])text(panel,'p',d);
      for(const [ref,label]of [[item.contractView,'Interface contract'],[item.exampleView,'Integration example']])if(ref&&doc.views.some(v=>v.id===ref)){const b=text(panel,'button',label);b.className='detail-link';b.addEventListener('click',()=>setView(ref));}
    }else{
      const entity=doc.entities?.find(e=>e.id===item.entity);
      text(panel,'p',entity?.responsibility??item.subtitle??'');
      if(entity){text(panel,'h3','Owns');for(const d of entity.owns??[])text(panel,'p',d);text(panel,'h3','Does not own');for(const d of entity.excludes??[])text(panel,'p',d);text(panel,'h3','Independent use');text(panel,'p',entity.independence);}
    }
    if(view().references?.length){
      text(panel,'h3','Contracts and evidence');
      for(const reference of view().references){
        const row=text(panel,'p','');text(row,'small',reference.kind+' ');
        const link=text(row,'a',reference.label);link.href=reference.url;link.target='_blank';link.rel='noopener noreferrer';
      }
    }
    $('#details').hidden=false;$('#details-toggle').setAttribute('aria-expanded','true');requestDraw();
  }
  function closeDetails(){$('#details').hidden=true;$('#details-toggle').setAttribute('aria-expanded','false');selected=null;requestDraw();}
  function exportFile(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function setDocument(data){doc=validateDocument(data);activeView=doc.views.some(v=>v.id===activeView)?activeView:doc.defaultView??doc.views[0].id;closeDetails();renderChrome();fit();toast('JSON loaded. Changes stay in this browser until exported.');}
  $('#fit').addEventListener('click',fit);
  function zoom(factor,cx=stage.clientWidth/2,cy=stage.clientHeight/2){const before=transform.z;transform.z=clamp(before*factor,.12,4);transform.x=cx-(cx-transform.x)*transform.z/before;transform.y=cy-(cy-transform.y)*transform.z/before;requestDraw();}
  $('#zoom-in').addEventListener('click',()=>zoom(1.2));$('#zoom-out').addEventListener('click',()=>zoom(1/1.2));
  stage.addEventListener('wheel',e=>{e.preventDefault();const r=stage.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const n=e.target.closest('[data-node]'),edge=e.target.closest('[data-edge]');
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,node:n?.dataset.node,edge:edge?.dataset.edge};stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if(Math.abs(dx)+Math.abs(dy)>.8)pointer.moved=true;
    pointer.x=e.clientX;pointer.y=e.clientY;
    if(pointer.node){const n=view().nodes.find(n=>n.id===pointer.node),wx=dx/transform.z,wy=view().kind==='sequence'?0:dy/transform.z;n.x+=wx;n.y+=wy;
      for(const edge of view().edges)if((edge.source===n.id||edge.target===n.id)&&edge.labelPosition){edge.labelPosition.x+=wx/2;edge.labelPosition.y+=wy/2;}
    }else if(!pointer.edge){transform.x+=dx;transform.y+=dy;}
    requestDraw();
  });
  stage.addEventListener('pointerup',e=>{if(!pointer)return;const p=pointer;pointer=null;try{stage.releasePointerCapture(e.pointerId);}catch{}if(!p.moved){if(p.node)inspect(p.node);else if(p.edge)inspect(p.edge,true);else closeDetails();}else if(p.node)toast('Node moved. Export JSON to save the layout.');});
  stage.addEventListener('pointercancel',()=>{pointer=null;});
  stage.addEventListener('keydown',e=>{const n=e.target.closest('[data-node]'),edge=e.target.closest('[data-edge]');if(e.key==='Enter'&&(n||edge)){e.preventDefault();inspect(n?.dataset.node??edge.dataset.edge,!n);}if(e.key==='Escape')closeDetails();});
  $('#details-close').addEventListener('click',closeDetails);
  $('#details-toggle').addEventListener('click',()=>{if(!$('#details').hidden)closeDetails();else inspect(view().nodes[0].id);});
  $('#export-json').addEventListener('click',()=>exportFile('diagram.json',JSON.stringify(doc,null,2)+'\n','application/json'));
  $('#export-svg').addEventListener('click',()=>exportFile(view().id+'.svg',exportSVG(doc,view()),'image/svg+xml'));
  $('#load-json').addEventListener('click',()=>$('#json-file').click());
  $('#json-file').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>2000000)throw new Error('JSON files are limited to 2 MB.');setDocument(JSON.parse(await file.text()));}catch(error){toast(error.message);}});
  $('#edit-json').addEventListener('click',()=>{$('#json-editor').value=JSON.stringify(doc,null,2);$('#editor-error').textContent='';$('#editor').showModal();});
  $('#editor-cancel').addEventListener('click',()=>$('#editor').close());
  $('#editor-apply').addEventListener('click',()=>{try{const value=$('#json-editor').value;if(value.length>2000000)throw new Error('JSON is limited to 2 MB.');setDocument(JSON.parse(value));$('#editor').close();}catch(error){$('#editor-error').textContent=error.message;}});
  function useSVG(){if(gpu){gpu.dispose();gpu=null;}engine='svg';requestDraw();}
  let loadingThree=false;
  async function useThree(){
    if(loadingThree||gpu)return;loadingThree=true;$('#engine').disabled=true;
    try {
      if(location.protocol==='file:')throw new Error('Run npm install, then npm start for Three.js. The standalone view uses SVG without a server.');
      const {ThreeDiagramRenderer}=await import('./source/three-renderer.mjs');
      gpu=new ThreeDiagramRenderer(stage,{onContextLost:()=>{useSVG();toast('WebGL context lost. SVG remains active.');}});engine='three';requestDraw();toast('Three.js geometry + SVG text. No CDN dependency.');
    }catch(error){useSVG();toast(error.message.includes('npm install')?error.message:'SVG active. Install the local Three.js dependency to enable WebGL.');}
    finally{loadingThree=false;$('#engine').disabled=false;}
  }
  $('#engine').addEventListener('click',()=>gpu?useSVG():useThree());
  window.addEventListener('keydown',e=>{if(e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLInputElement)return;if(e.key==='0')fit();if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(1/1.2);});
  const ro=new ResizeObserver(()=>{requestDraw();});ro.observe(stage);
  window.addEventListener('pagehide',()=>{disposed=true;ro.disconnect();gpu?.dispose();},{once:true});
  window.diagramEditor=Object.freeze({getJSON:()=>structuredClone(doc),setJSON:setDocument,selectView:setView,fit,getRenderer:()=>gpu?'three':'svg'});
  renderChrome();fit();
  if(location.protocol==='http:'||location.protocol==='https:') {
    void (async () => {
      try {
        const response=await fetch('./diagram.json',{cache:'no-store'});
        if(!response.ok)throw new Error('diagram.json could not be loaded');
        setDocument(await response.json());
      } catch(error) { toast('Embedded diagram shown: '+error.message); }
      await useThree();
    })();
  }
})();
