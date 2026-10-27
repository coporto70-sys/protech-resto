(function(){
const SC = window.__SCEN;
const DB = SC.db; window.__DB = DB;
const handlers = [];
function mk(t){
  const st={t,op:'select',f:[],ord:[],lim:null,single:false,maybe:false,payload:null,ret:false};
  const api={
    select(){ if(st.op==='insert'||st.op==='update') st.ret=true; return api; },
    eq(c,v){st.f.push(r=>r[c]===v);return api;},
    gte(c,v){st.f.push(r=>r[c]>=v);return api;},
    lt(c,v){st.f.push(r=>r[c]<v);return api;},
    not(c,op,v){st.f.push(r=>op==='is'&&v===null?(r[c]!=null):r[c]!==v);return api;},
    is(c,v){st.f.push(r=>(r[c]??null)===v);return api;},
    order(c,o){st.ord.push([c,o&&o.ascending===false?-1:1]);return api;},
    limit(n){st.lim=n;return api;}, single(){st.single=true;return api;}, maybeSingle(){st.maybe=true;return api;},
    insert(p){st.op='insert';st.payload=p;return api;}, upsert(p,o){st.op='upsert';st.payload=p;return api;}, in(c,v){st.f.push(r=>v.includes(r[c]));return api;}, update(p){st.op='update';st.payload=p;return api;}, delete(){st.op='delete';return api;},
    then(res,rej){ return Promise.resolve(run()).then(res,rej); }
  };
  function run(){
    if(window.__OFFLINE) return {data:null,error:{message:'TypeError: Failed to fetch'}};
    if(SC.missing && SC.missing.includes(t)) return {data:null,error:{message:'relation "public.'+t+'" does not exist'}};
    const rows = DB[t] = DB[t] || [];
    if(SC.noDesglose && t==='resto_turnos' && st.payload && ('desglose_apertura' in st.payload || 'desglose_cierre' in st.payload)) return {data:null,error:{message:"Could not find the 'desglose_apertura' column of 'resto_turnos' in the schema cache"}};
    if(st.op==='upsert'){ const arr=Array.isArray(st.payload)?st.payload:[st.payload]; arr.forEach(p=>{ if(!rows.some(r=>r.id===p.id)) rows.push(Object.assign({created_at:new Date().toISOString()},p)); }); return {data:null,error:null}; }
    if(st.op==='insert'){
      const n = Object.assign({id:'id'+Math.random().toString(36).slice(2,9),created_at:new Date().toISOString(),abierto_at:new Date().toISOString()}, st.payload);
      rows.push(n);
      setTimeout(()=>handlers.filter(h=>h.table===t&&h.event==='INSERT').forEach(h=>h.cb({new:n})),20);
      return st.single?{data:n,error:null}:{data:[n],error:null};
    }
    let out = rows.filter(r=>st.f.every(f=>f(r)));
    if(st.op==='update'){ out.forEach(r=>Object.assign(r,st.payload)); return {data:out,error:null}; }
    st.ord.forEach(([c,d])=>{ out=out.slice().sort((a,b)=>(a[c]>b[c]?1:a[c]<b[c]?-1:0)*d); });
    if(st.lim!=null) out=out.slice(0,st.lim);
    if(st.single) return out.length?{data:out[0],error:null}:{data:null,error:{message:'no rows'}};
    if(st.maybe) return {data:out[0]||null,error:null};
    return {data:out,error:null};
  }
  return api;
}
const user = {id:'u1',email:SC.email,app_metadata:{role:SC.role||''}};
window.supabase={createClient:()=>({
  from:mk,
  functions:{invoke:async(name,opt)=>{ window.__IA_CALLS=(window.__IA_CALLS||0)+1; if(SC.ia==='sim'){ const u=opt.body.messages.slice(-1)[0].content; return {data:{texto:'Respuesta de IA simulada: '+u,humano:/mal hecho/.test(u)},error:null}; } const ia={error:'sin_clave'}; return {data:ia,error:{message:'fn'}}; }},
  rpc:async(name,p)=>{ if(window.__OFFLINE) return {data:null,error:{message:'TypeError: Failed to fetch'}}; (window.__RPC=window.__RPC||[]).push([name,p]);
    if(name==='resto_cerrar_turno_corte'){ if(SC.sinCorte) return {data:null,error:{message:'Could not find the function public.resto_cerrar_turno_corte in the schema cache'}};
      const T=(DB.resto_turnos=DB.resto_turnos||[]), t=T.find(x=>x.id===p.p_turno&&!x.cerrado_at); if(!t) return {data:null,error:{message:'No hay un turno abierto con ese identificador'}};
      const c=new Date(p.p_corte); if(c<=new Date(t.abierto_at)||c>new Date()) return {data:null,error:{message:'La fecha de corte debe estar entre la apertura del turno y este momento'}};
      const nid='T'+Math.random().toString(36).slice(2,7); T.push({id:nid,local_id:t.local_id,abierto_por:p.p_cierre.cerrado_por,abierto_at:p.p_corte,monto_inicial:p.p_cierre.monto_nuevo||0,desglose_apertura:p.p_cierre.desglose_deja,cerrado_at:null});
      ['resto_gastos','resto_cuentas'].forEach(k=>(DB[k]||[]).forEach(r=>{ if(r.turno_id===t.id&&new Date(r.created_at)>c) r.turno_id=nid; }));
      (DB.resto_sesiones||[]).forEach(r=>{ if(r.turno_id===t.id&&new Date(r.entrada)>c) r.turno_id=nid; else if(r.turno_id===t.id&&!r.salida) r.salida=p.p_corte; });
      Object.assign(t,{cerrado_at:p.p_corte,cerrado_por:p.p_cierre.cerrado_por,esperado_efectivo:p.p_cierre.esperado_efectivo,contado_efectivo:p.p_cierre.contado_efectivo,diferencia:p.p_cierre.diferencia,ventas_total:p.p_cierre.ventas_total,cuentas:p.p_cierre.cuentas,nota:p.p_cierre.nota,desglose_cierre:p.p_cierre.desglose_cierre,desglose_deja:p.p_cierre.desglose_deja,retiro_efectivo:p.p_cierre.retiro_efectivo,gastos_total:p.p_cierre.gastos_total,propinas_pagadas:p.p_cierre.propinas_pagadas,pago_propinas:p.p_cierre.pago_propinas});
      return {data:nid,error:null}; }
    if(name==='resto_qr_confirmar'){ const r=(DB.resto_qr_pedidos||[]).find(x=>x.id===p.p_pedido); if(!r) return {data:null,error:{message:'pedido_no_existe'}}; if(r.estado!=='por_confirmar') return {data:{ok:true,ya:r.estado},error:null}; r.estado='confirmado'; (DB.resto_comandas=DB.resto_comandas||[]).push({id:'cq'+Math.random().toString(36).slice(2,7),local_id:r.local_id,mesa:r.mesa,items:r.items,nota:r.nota,garzon:null,estado:'pendiente',cerrada:false,qr_pedido_id:r.id,created_at:new Date().toISOString()}); return {data:{ok:true},error:null}; }
    if(name==='resto_qr_rechazar'){ const r=(DB.resto_qr_pedidos||[]).find(x=>x.id===p.p_pedido); if(!r) return {data:null,error:{message:'pedido_no_existe'}}; r.estado='rechazado'; r.motivo=p.p_motivo||null; return {data:{ok:true},error:null}; }
    if(name==='resto_qr_atender'){ const a=(DB.resto_qr_avisos||[]).find(x=>x.id===p.p_aviso); if(a) a.atendido=true; return {data:{ok:true},error:null}; }
    if(name==='resto_sesion_estado') return {data:SC.sesionVencida?null:{rol:'admin',quien:'x',caja:true},error:null};
    if(name==='resto_login'||name==='resto_login_ing'||name==='resto_pin_set'||name==='resto_logout'){ if(SC.noPases) return {data:null,error:{message:'Could not find the function public.'+name+' in the schema cache'}}; }
    if(name==='resto_login'){ window.__LOGINS=(window.__LOGINS||0)+1; if(SC.bloq) return {data:{ok:false,error:'bloqueado'},error:null}; return {data:(p.p_pin===(SC.pinOk||'1234')||(!p.p_pin&&SC.sinPinOk))?{ok:true,token:'TOK'+p.p_rol,quien:p.p_rol==='admin'?'Administradora':'Ana',rol:p.p_rol,caja:true}:{ok:false,error:'pin'},error:null}; }
    if(name==='resto_login_ing') return {data:p.p_clave==='ing'?{ok:true,token:'TOKING',quien:'Carlos Oporto',rol:'ingeniero',caja:true}:{ok:false,error:'pin'},error:null};
    if(name==='resto_pin_set'){ return {data:null,error:null}; } if(name==='resto_insumo_mover'){ const ins=(DB.resto_insumos||[]).find(i=>i.id===p.p_insumo); if(!ins) return {data:null,error:{message:'Insumo no encontrado'}}; const nuevo=(+ins.stock||0)+p.p_delta; if(nuevo<0) return {data:null,error:{message:'No alcanza el stock'}}; ins.stock=nuevo; if(p.p_motivo==='compra'&&p.p_costo) ins.costo_unit=Math.round(p.p_costo/p.p_delta*100)/100; (DB.resto_insumo_mov=DB.resto_insumo_mov||[]).push({id:'m'+Math.random(),local_id:ins.local_id,insumo_id:ins.id,delta:p.p_delta,motivo:p.p_motivo,stock_despues:ins.stock,costo_total:p.p_costo||null,tipo_doc:p.p_tipo||null,numero_doc:p.p_num||null,proveedor:p.p_prov||null,nota:p.p_nota||null,pagado_caja:!!p.p_caja,registrado_por:p.p_por,created_at:new Date().toISOString()}); return {data:ins.stock,error:null}; } return {data:0,error:null}; },
  auth:{getSession:async()=>({data:{session:{user,access_token:'tok'}}}),onAuthStateChange(){},signOut:async()=>({}),refreshSession:async()=>({data:{session:{user}}}),updateUser:async()=>({}),resetPasswordForEmail:async()=>({}),signInWithPassword:async()=>({})},
  channel(){ const c={on(type,cfg,cb){handlers.push({table:cfg.table,event:cfg.event,cb});return c;},subscribe(){return c;}}; return c; },
  storage:{from(b){ return { upload:async(path,blob,o)=>{ (window.__UP=window.__UP||[]).push({b,path,size:blob.size,type:blob.type}); return {data:{path},error:null}; }, getPublicUrl:path=>({data:{publicUrl:'https://fotos.test/'+b+'/'+path}}), remove:async(l)=>{ (window.__RM=window.__RM||[]).push(...l); return {data:null,error:null}; } }; }},
  removeChannel(){}
})};
window.__emitSoporte=(row)=>{ const n=Object.assign({id:'s'+Math.random().toString(36).slice(2,8),created_at:new Date().toISOString()},row); DB.resto_chat.push(n); handlers.filter(h=>h.table==='resto_chat'&&h.event==='INSERT').forEach(h=>h.cb({new:n})); };
})();
