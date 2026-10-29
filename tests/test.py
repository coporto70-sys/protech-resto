import json, sys, threading, http.server, socketserver, functools, datetime
from playwright.sync_api import sync_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
H=functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(H.func):
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); PORT=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
stub=open(os.path.join(HERE,'stub.js')).read()
now=datetime.datetime.utcnow()
iso=lambda m: (now-datetime.timedelta(minutes=m)).isoformat()+'Z'
today=datetime.date.today().isoformat()
def base_db(chat=True):
    db={
     'resto_miembros':[{'local_id':'L1'}],
     'resto_locales':[{'id':'L1','nombre':'Super Pastel','mesas':8,'mesas2':6,'admin_pin':''}],
     'resto_menu':[{'id':'m1','local_id':'L1','nombre':'Café','categoria':'Bebidas','precio':2500,'activo':True,'estacion':'cafeteria','stock':3,'stock_min':5,'codigo':'123'},
                   {'id':'m2','local_id':'L1','nombre':'Torta','categoria':'Pasteles','precio':0,'activo':True,'estacion':'cocina','stock':None,'stock_min':0}],
     'resto_comandas':[{'id':'c1','local_id':'L1','mesa':3,'items':[{'n':'Café','q':2}],'nota':'','estado':'pendiente','garzon':'Ana','created_at':iso(300),'cerrada':False}],
     'resto_cuentas':[{'id':'q1','local_id':'L1','mesa':2,'total':12000,'propina':1000,'propina_efec':500,'propina_tarj':500,'metodo':'Efectivo','garzon':'Ana','items':[{'n':'Café','q':2}],'turno_id':None,'cobrado_por':'Ana','created_at':iso(30)}],
     'resto_garzones':[{'id':'g1','local_id':'L1','nombre':'Ana','activo':True,'pin':'','caja':True}],
     'resto_cocineras':[], 'resto_turnos':[], 'resto_pedidos':[], 'resto_reservas':[], 'resto_sesiones':[],
    }
    if chat: db['resto_chat']=[]
    return db
results=[]
def check(name,cond):
    results.append((name,bool(cond))); print(('PASS ' if cond else 'FAIL ')+name)
def run(scen, fn, ls=''):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={'width':1200,'height':800})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.add_init_script('window.__SCEN='+json.dumps(scen)+';'+stub+';'+ls)
        pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body='/*stub*/',content_type='application/javascript'))
        pg.route('**/functions/v1/admin-resto',lambda r:r.fulfill(json={'locales':[{'id':'L1','nombre':'Super Pastel','mesas':8,'usuarios':[{'email':'dueno@sp.cl','confirmado':True},{'email':'nuevo@sp.cl','confirmado':False}]},{'id':'L2','nombre':'Café Valeria','mesas':5,'usuarios':[]}]}))
        pg.goto('http://127.0.0.1:'+str(PORT)+'/index.html'); pg.wait_for_timeout(800)
        fn(pg); b.close(); return errs

# --- A: cliente
def A(pg):
    check('A: ya no existe el chat de ayuda (botón naranja)', pg.locator('#chat-fab').count()==0 and pg.locator('#chat-root').count()==0)
    check('A: Robi está en la pantalla y es la ayuda', pg.locator('#robi').is_visible() and 'Pregúntale a Robi' in pg.inner_html('#robi'))
    check('A: fuera de Caja el globo parte cerrado para no tapar botones', pg.locator('#robi.min').count()==1)
    pg.click('#robi .robi-cara'); pg.wait_for_timeout(200)
    check('A: tocando a Robi se abre el globo', pg.locator('#robi.min').count()==0)
    pg.fill('#robi-in','¿Cómo cobro una mesa?'); pg.click('[data-act="robi-preg"]'); pg.wait_for_timeout(300)
    t=pg.inner_text('#robi-b')
    check('A: Robi responde sobre cobrar', 'Cobrar' in t and 'vuelto' in t)
    pg.click('[data-act="robi-volver"]'); pg.wait_for_timeout(200)
    check('A: Volver regresa al consejo de la pestaña', 'mesas' in pg.inner_text('#robi-b').lower() and 'tu pregunta' not in pg.inner_text('#robi-b').lower())
    pg.fill('#robi-in','xyzzy qwerty plugh'); pg.press('#robi-in','Enter'); pg.wait_for_timeout(300)
    t=pg.inner_text('#robi-b')
    check('A: sin respuesta manda a Protech por WhatsApp', 'No encontré' in t and '3947 3588' in t and pg.locator('#robi-b a[href*="wa.me/56939473588"]').count()==1)
    check('A: no se crean mensajes de chat ni se avisa a soporte', len(pg.evaluate('window.__DB.resto_chat'))==0)
    pg.fill('#robi-in','no me suena la cocina'); pg.click('[data-act="robi-preg"]'); pg.wait_for_timeout(300)
    check('A: responde sobre sonido', 'Sonido' in pg.inner_text('#robi-b'))
    pg.fill('#robi-in','se cierra la sesión a cada rato'); pg.click('[data-act="robi-preg"]'); pg.wait_for_timeout(300)
    check('A: responde sobre sesión', '16 horas' in pg.inner_text('#robi-b'))
    pg.click('[data-act="tab"][data-v="cocina"]'); pg.wait_for_timeout(300)
    check('A: al cambiar de pestaña Robi da el consejo de esa pestaña', 'cocina' in pg.inner_text('#robi-b').lower() and 'tu pregunta' not in pg.inner_text('#robi-b').lower())
    for v,tx in [('resumen','Resumen'),('turno','Caja'),('carta','Carta')]:
        if pg.locator(f'[data-act="tab"][data-v="{v}"]').count():
            pg.click(f'[data-act="tab"][data-v="{v}"]'); pg.wait_for_timeout(250)
            check(f'A: Robi acompaña en la pestaña {v}', pg.locator('#robi').is_visible() and tx.lower() in pg.inner_text('#robi-b').lower())
e=run({'email':'dueno@sp.cl','role':'','db':base_db()},A); print('ERR A',e)

# --- B: soporte
def B(pg):
    check('B: Robi y el botón de ayuda NO aparecen para soporte', pg.locator('#robi').count()==0 and pg.locator('#chat-fab').count()==0)
    check('B: ve 3 pestañas del portal', pg.locator('[data-sp="sub"]').count()==3)
    pg.click('[data-sp="sub"][data-v="revisar"]'); pg.wait_for_timeout(200)
    pg.click('[data-sp="rev"][data-lid="L1"]'); pg.wait_for_timeout(700)
    t=pg.inner_text('#app')
    check('B: resumen muestra ventas de hoy', 'Ventas de hoy' in t and '12.000' in t)
    pg.click('[data-sp="tab"][data-v="diag"]'); pg.wait_for_timeout(200)
    t=pg.inner_text('#app')
    check('B: diagnóstico detecta precio 0', 'precio 0' in t)
    check('B: diagnóstico detecta stock bajo', 'stock bajo' in t.lower())
    check('B: diagnóstico detecta comanda vieja', 'más de 4 horas' in t)
    check('B: diagnóstico detecta invitación pendiente', 'nuevo@sp.cl' in t)
    pg.click('[data-sp="tab"][data-v="ventas"]'); pg.wait_for_timeout(200)
    check('B: ventas por garzón', 'Ana' in pg.inner_text('#app'))
    with pg.expect_download() as dl: pg.click('[data-sp="csv"]')
    check('B: descarga CSV', dl.value.suggested_filename.endswith('.csv'))
    for tab,txt in [('coms','Café'),('carta','Torta'),('equipo','Garzones'),('inv','stock'),('resv','Reservas'),('cajas','Turnos')]:
        pg.click(f'[data-sp="tab"][data-v="{tab}"]'); pg.wait_for_timeout(150)
        check(f'B: pestaña {tab} se muestra', txt.lower() in pg.inner_text('#app').lower())
    pg.evaluate("window.__emitSoporte({local_id:'L1',autor:'cliente',quien:'Ana',texto:'La caja no cierra',humano:true})"); pg.wait_for_timeout(300)
    check('B: aviso de nuevo mensaje (insignia)', '🔴1' in pg.inner_text('#app'))
    pg.click('[data-sp="sub"][data-v="chat"]'); pg.wait_for_timeout(300)
    check('B: bandeja muestra el hilo', 'Super Pastel' in pg.inner_text('#app') and 'nuevo' in pg.inner_text('#app'))
    pg.click('[data-sp="hilo"][data-lid="L1"]'); pg.wait_for_timeout(300)
    check('B: conversación visible', 'La caja no cierra' in pg.inner_text('#sp-msgs'))
    pg.fill('#sp-reply','Hola Ana, dime qué mensaje te sale'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    rows=pg.evaluate('window.__DB.resto_chat')
    check('B: respuesta guardada como soporte', any(r['autor']=='soporte' and 'qué mensaje' in r['texto'] for r in rows))
    check('B: mensajes marcados vistos', all(r.get('visto_soporte') for r in rows if r['autor']=='cliente'))
    check('B: input se vacía tras enviar', pg.input_value('#sp-reply')=='')
db=base_db(); db['resto_miembros']=[]
db['resto_chat']=[]
e=run({'email':'gerencia@protechdigital.cl','role':'protech_admin','db':db},B); print('ERR B',e)

# --- C: sin migración
def C(pg):
    check('C: sin tabla de chat, Robi sigue ayudando y no hay botón de chat', pg.locator('#robi').is_visible() and pg.locator('#chat-fab').count()==0)
    check('C: la app sigue funcionando', 'Mesa' in pg.inner_text('#app') or 'Mesas' in pg.inner_text('#app'))
e=run({'email':'dueno@sp.cl','role':'','db':base_db(chat=False),'missing':['resto_chat']},C); print('ERR C',e)
def C2(pg):
    pg.click('[data-sp="sub"][data-v="chat"]'); pg.wait_for_timeout(400)
    check('C2: soporte ve aviso de migración pendiente', 'migración' in pg.inner_text('#app'))
db=base_db(chat=False); db['resto_miembros']=[]
e=run({'email':'g@x.cl','role':'protech_admin','db':db,'missing':['resto_chat']},C2); print('ERR C2',e)

# --- D: sin IA, solo guía y soporte
def D(pg):
    pg.click('#robi .robi-cara'); pg.wait_for_timeout(200)
    pg.fill('#robi-in','¿Cómo cobro una mesa?'); pg.click('[data-act="robi-preg"]'); pg.wait_for_timeout(300)
    check('D: pregunta conocida responde con la guía', 'vuelto' in pg.inner_text('#robi-b'))
    pg.fill('#robi-in','la impresora de boletas no imprime nada'); pg.click('[data-act="robi-preg"]'); pg.wait_for_timeout(300)
    check('D: duda desconocida manda a Protech por WhatsApp', 'WhatsApp' in pg.inner_text('#robi-b'))
    check('D: nunca se llama a la IA', (pg.evaluate('window.__IA_CALLS||0'))==0)
    check('D: no se guarda nada en el chat', len(pg.evaluate('window.__DB.resto_chat'))==0)
e=run({'email':'dueno@sp.cl','role':'','db':base_db(),'ia':'sim'},D); print('ERR D',e)

# --- E/F/G/H: caja con billetes y monedas
LS_ANA="localStorage.setItem('pr-rol', JSON.stringify({lid:'L1',rol:'garzon',quien:'Ana',tok:'T',t:Date.now()}));"
def db_roles(caja=True):
    d=base_db(); d['resto_locales'][0]['admin_pin']='x'; d['resto_garzones'][0].update({'pin':'h','caja':caja}); d['resto_comandas']=[]; return d
def nav_caja(pg):
    pg.click('[data-act="tab"][data-v="turno"]'); pg.wait_for_timeout(300)
dialogs=[]
def E(pg):
    pg.on('dialog',lambda d:(dialogs.append(d.message),d.accept()))
    check('E: garzón autorizado ve la pestaña Caja', pg.locator('[data-act="tab"][data-v="turno"]').count()==1)
    nav_caja(pg)
    t=pg.inner_text('#app')
    check('E: formulario de apertura con todos los billetes y monedas', 'Abrir caja' in t and all(x in t for x in ['$20.000','$10.000','$5.000','$2.000','$1.000','Monedas de $500','Monedas de $100','Monedas de $50','Monedas de $10']))
    pg.fill('#dna-20000','40000'); pg.fill('#dna-10000','30000'); pg.fill('#dna-500','2000'); pg.wait_for_timeout(150)
    check('E: total de apertura se calcula en vivo', '$72.000' in pg.inner_text('#dnt-a'))
    check('E: detalle por denominación (cantidad de billetes)', '2' in pg.inner_text('[id="dna-20000-s"]'))
    pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(700)
    tu=pg.evaluate('window.__DB.resto_turnos')
    check('E: turno abierto con monto inicial correcto', len(tu)==1 and tu[0]['monto_inicial']==72000)
    check('E: se guarda el desglose de apertura', tu[0].get('desglose_apertura')=={'20000':2,'10000':3,'500':4})
    check('E: abrió quien corresponde', tu[0]['abierto_por']=='Ana')
    tid=tu[0]['id']
    pg.evaluate("""(tid)=>{const n=new Date().toISOString(); window.__DB.resto_cuentas.push({id:'v1',local_id:'L1',mesa:1,total:10000,propina:0,propina_efec:0,propina_tarj:0,metodo:'Efectivo',garzon:'Ana',items:[],turno_id:tid,cobrado_por:'Ana',created_at:n},{id:'v2',local_id:'L1',mesa:2,total:5000,propina:0,propina_efec:0,propina_tarj:0,metodo:'Tarjeta',garzon:'Ana',items:[],turno_id:tid,cobrado_por:'Ana',created_at:n});}""",tid)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(500)
    t=pg.inner_text('#app')
    check('E: con caja abierta aparece el cierre con conteo', 'Cerrar caja' in t and 'Efectivo contado' in t)
    pg.fill('#dnc-20000','40000'); pg.fill('#dnc-10000','40000'); pg.fill('#dnc-500','2000'); pg.fill('#ctarj','5000'); pg.fill('#ctrans','0'); pg.wait_for_timeout(200)
    c=pg.inner_text('#cuadre'); print('DBG',repr(c),dialogs,pg.evaluate('JSON.stringify([D.turno,D.cuentas.map(x=>[x.t,x.metodo,x.total])])'))
    check('E: cuadre en vivo: efectivo, tarjetas y transferencias cuadran', c.count('Cuadra')==3)
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(800)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('E: caja cerrada', tu.get('cerrado_at') is not None)
    check('E: efectivo contado y diferencia 0', tu['contado_efectivo']==82000 and tu['diferencia']==0 and tu['esperado_efectivo']==82000)
    dc=tu.get('desglose_cierre') or {}
    check('E: desglose de cierre guardado', dc.get('efectivo')=={'20000':2,'10000':4,'500':4} and dc.get('tarjeta')==5000 and dc.get('transferencia')==0)
    check('E: vuelve a mostrar apertura de caja', 'Abrir caja' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':db_roles()},E,LS_ANA); print('ERR E',e)

def F(pg):
    d=[]
    pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg); pg.fill('#dna-10000','10000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(600)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    pg.fill('#dnc-10000','20000'); pg.fill('#ctarj','0'); pg.fill('#ctrans','0'); pg.wait_for_timeout(200)
    check('F: el cuadre muestra lo que sobra', 'Sobra $10.000' in pg.inner_text('#cuadre'))
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(500)
    check('F: sin observación no deja cerrar si hay diferencia', any('no cuadra' in m for m in d) and pg.evaluate('window.__DB.resto_turnos')[0].get('cerrado_at') is None)
    pg.fill('#tnota','Sobró por un vuelto mal dado'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(700)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('F: con observación cierra y registra la diferencia', tu.get('cerrado_at') and tu['diferencia']==10000 and 'vuelto' in tu['nota'])
e=run({'email':'u','role':'','db':db_roles()},F,LS_ANA); print('ERR F',e)

def F2(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg); pg.fill('#dna-5000','5000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(600)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    pg.fill('#dnc-5000','5000'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(400)
    check('F2: exige total de tarjetas y transferencias', any('tarjetas' in m for m in d) and pg.evaluate('window.__DB.resto_turnos')[0].get('cerrado_at') is None)
e=run({'email':'u','role':'','db':db_roles()},F2,LS_ANA); print('ERR F2',e)

def G(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg); pg.fill('#dna-20000','20000'); pg.fill('#dna-1000','2000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(700)
    tu=pg.evaluate('window.__DB.resto_turnos')
    check('G: sin columnas nuevas igual abre la caja', len(tu)==1 and tu[0]['monto_inicial']==22000)
    check('G: el detalle queda en la nota', 'Sencillo inicial' in (tu[0].get('nota') or '') and '1×$20.000' in tu[0]['nota'])
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    pg.fill('#dnc-20000','20000'); pg.fill('#dnc-1000','2000'); pg.fill('#ctarj','0'); pg.fill('#ctrans','0'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(700)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('G: sin columnas nuevas igual cierra, con detalle en la nota', tu.get('cerrado_at') and 'Sencillo inicial' in tu['nota'] and 'Cierre:' in tu['nota'])
e=run({'email':'u','role':'','db':db_roles(),'noDesglose':True},G,LS_ANA); print('ERR G',e)


def J(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg); pg.fill('#dna-10000','10000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(600)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('J: la Caja ya no muestra productos ni venta', pg.locator('.pos-it').count()==0 and pg.locator('#scan-mos').count()==0 and pg.locator('#bus-mos').count()==0 and 'Venta mostrador' not in t and pg.locator('[data-act="mostrador"]').count()==0)
    check('J: la Caja muestra el cuadre y el cierre', 'Cobrado por' in t or 'Mis cobros' in t, ) if False else check('J: la Caja muestra el cierre con cuadre', 'Cerrar caja' in t and 'Cuadre con lo vendido' in t and 'Mis cobros de este turno' in t)
    pg.click('[data-act="tab"][data-v="mesas"]'); pg.wait_for_timeout(300)
    check('J: en Mesas sigue la venta mostrador', pg.locator('[data-act="mostrador"]').count()==1)
e=run({'email':'u','role':'','db':db_roles()},J,LS_ANA); print('ERR J',e)


def db_fondo():
    d=db_roles(); d['resto_locales'][0]['fondo_caja']=160000; d['resto_gastos']=[]; return d
def K(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg)
    check('K: al abrir se informa el sencillo fijo', '$160.000' in pg.inner_text('#app'))
    pg.fill('#dna-20000','100000'); pg.fill('#dna-10000','60000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(700)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    check('K: caja abierta muestra gastos y sencillo que queda', 'Gastos pagados desde caja' in pg.inner_text('#app') and 'Sencillo que queda en caja' in pg.inner_text('#app'))
    pg.fill('#g-prov','Panadería Lola'); pg.fill('#g-det','Pan para el día'); pg.fill('#g-monto','15000'); pg.click('[data-act="gasto"]'); pg.wait_for_timeout(400)
    check('K: exige número de boleta', any('número de la boleta' in m for m in d) and pg.evaluate('window.__DB.resto_gastos.length')==0)
    pg.fill('#g-num','1234'); pg.click('[data-act="gasto"]'); pg.wait_for_timeout(800)
    g=pg.evaluate('window.__DB.resto_gastos')
    check('K: gasto registrado con documento, número y monto', len(g)==1 and g[0]['tipo']=='Boleta' and g[0]['numero']=='1234' and g[0]['monto']==15000 and g[0]['registrado_por']=='Ana' and g[0]['turno_id'])
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('K: el gasto aparece en la lista del turno', 'Boleta N° 1234' in t and 'Panadería Lola' in t and 'Total gastos del turno' in t)
    tid=pg.evaluate('window.__DB.resto_turnos[0].id')
    pg.evaluate("""(tid)=>{window.__DB.resto_cuentas.push({id:'k1',local_id:'L1',mesa:1,total:30000,propina:0,propina_efec:0,propina_tarj:0,metodo:'Efectivo',garzon:'Ana',items:[],turno_id:tid,cobrado_por:'Ana',created_at:new Date().toISOString()});}""",tid)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(500)
    pg.fill('#dnc-20000','100000'); pg.fill('#dnc-10000','60000'); pg.fill('#dnc-5000','15000'); pg.fill('#ctarj','0'); pg.fill('#ctrans','0')
    pg.fill('#dnd-20000','80000'); pg.fill('#dnd-10000','60000'); pg.wait_for_timeout(300)
    c=pg.inner_text('#cuadre')
    check('K: el efectivo esperado descuenta el gasto y cuadra', 'Sistema $175.000' in c and 'descuenta $15.000' in c)
    check('K: el sencillo que se deja es libre (ya no hay sencillo fijo)', 'Anotado' in c and 'Falta $20.000' not in c and 'Efectivo de ventas a retirar' in c and '$35.000' in c)
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(800)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('K: cierre guarda retiro, sencillo dejado y gastos', tu.get('cerrado_at') and tu['retiro_efectivo']==35000 and tu['desglose_deja']=={'20000':4,'10000':6} and tu['gastos_total']==15000 and tu['diferencia']==0)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(500)
    nav_caja(pg); t=pg.inner_text('#app')
    check('K: el turno siguiente debe recibir lo que dejó el anterior', 'Debes recibir $140.000' in t and 'lo que dejó el turno anterior' in t)
    pg.fill('#dna-20000','100000'); pg.wait_for_timeout(200)
    check('K: avisa si el sencillo recibido no coincide con el que se dejó', 'Faltan $40.000' in pg.inner_text('#aper'))
    pg.fill('#dna-20000','140000'); pg.wait_for_timeout(200)
    check('K: coincide con lo que dejó el turno anterior', 'Coincide con lo que dejó el turno anterior' in pg.inner_text('#aper'))
e=run({'email':'u','role':'','db':db_fondo()},K,LS_ANA); print('ERR K',e)

LS_ADM2="localStorage.setItem('pr-rol', JSON.stringify({lid:'L1',rol:'admin',quien:'Administradora',tok:'T',t:Date.now()}));"
def K2(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg)
    pg.fill('#fondo-in','160000'); pg.click('[data-act="setfondo"]'); pg.wait_for_timeout(600)
    check('K2: la administradora define el sencillo fijo', pg.evaluate('window.__DB.resto_locales[0].fondo_caja')==160000)
    check('K2: la administradora ve el historial de gastos', 'Historial de gastos de caja' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':db_roles()},K2,LS_ADM2); print('ERR K2',e)


def db_gasto():
    d=db_roles(); n=(__import__('datetime').datetime.utcnow()-__import__('datetime').timedelta(minutes=5)).isoformat()+'Z'
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Ana','monto_inicial':100000,'abierto_at':n,'created_at':n}]
    d['resto_gastos']=[{'id':'G1','local_id':'L1','turno_id':'T1','tipo':'Boleta','numero':'555','proveedor':'Ferretería','detalle':'Ampolleta','monto':4000,'registrado_por':'Ana','created_at':n,'anulado':False}]
    return d
def K3(pg):
    pg.on('dialog',lambda x:x.accept('Boleta duplicada') if x.type=='prompt' else x.accept())
    nav_caja(pg)
    check('K3: el cajero ve el botón Pedir anulación y no Anular', pg.locator('[data-act="gpedir"]').count()==1 and pg.locator('[data-act="ganular"]').count()==0)
    pg.click('[data-act="gpedir"]'); pg.wait_for_timeout(700)
    g=pg.evaluate('window.__DB.resto_gastos[0]')
    check('K3: la solicitud queda registrada con quién y por qué', g.get('anul_pedida_por')=='Ana' and g.get('anul_pedida_motivo')=='Boleta duplicada' and not g.get('anulado'))
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    check('K3: el cajero ve que espera a la administradora', 'espera a la administradora' in pg.inner_text('#app') and pg.locator('[data-act="gpedir"]').count()==0)
e=run({'email':'u','role':'','db':db_gasto()},K3,LS_ANA); print('ERR K3',e)

def K4(pg):
    pg.on('dialog',lambda x:x.accept('Se pagó dos veces') if x.type=='prompt' else x.accept())
    nav_caja(pg)
    check('K4: la administradora ve el botón Anular', pg.locator('[data-act="ganular"]').count()==1)
    check('K4: el gasto cuenta en el efectivo esperado', '$4.000' in pg.inner_text('#app'))
    pg.click('[data-act="ganular"]'); pg.wait_for_timeout(700)
    g=pg.evaluate('window.__DB.resto_gastos')
    check('K4: el gasto queda anulado y el registro se conserva', len(g)==1 and g[0]['anulado'] is True and g[0]['anulado_motivo']=='Se pagó dos veces' and g[0]['anulado_por']=='Administradora')
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('K4: se ve tachado con el motivo y ya no suma', 'Anulado por Administradora: Se pagó dos veces' in t and 'Total gastos del turno' not in t.split('Anulado por')[0][-5:] and pg.locator('[data-act="ganular"]').count()==0)
e=run({'email':'u','role':'','db':db_gasto()},K4,LS_ADM2); print('ERR K4',e)

def db_gasto_mal():
    d=db_gasto(); d['resto_gastos'][0]['monto']=1000000; return d
def K5(pg):
    pg.on('dialog',lambda x:x.accept('100.000' if 'Monto correcto' in x.message else 'Error al digitar el monto') if x.type=='prompt' else x.accept())
    nav_caja(pg)
    check('K5: la administradora ve el botón Corregir monto', pg.locator('[data-act="geditar"]').count()==1 and '$1.000.000' in pg.inner_text('#app'))
    pg.click('[data-act="geditar"]'); pg.wait_for_timeout(700)
    g=pg.evaluate('window.__DB.resto_gastos[0]')
    check('K5: el monto queda corregido con quién y por qué', g['monto']==100000 and g.get('editado_motivo')=='Error al digitar el monto' and g.get('editado_por')=='Administradora' and not g.get('anulado'))
    pg.evaluate("window.__DB.resto_gastos[0].monto_original=1000000")  # lo hace el trigger de la base real
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('K5: se ve el monto nuevo y el original', 'Corregido por Administradora: era $1.000.000' in t and '$100.000' in t)
e=run({'email':'u','role':'','db':db_gasto_mal()},K5,LS_ADM2); print('ERR K5',e)

def K6(pg):
    nav_caja(pg)
    check('K6: el cajero no ve Corregir monto', pg.locator('[data-act="geditar"]').count()==0)
e=run({'email':'u','role':'','db':db_gasto_mal()},K6,LS_ANA); print('ERR K6',e)


def db_cobro_mal():
    d=db_gasto(); n=(__import__('datetime').datetime.utcnow()-__import__('datetime').timedelta(minutes=2)).isoformat()+'Z'
    d['resto_gastos']=[]
    d['resto_cuentas']=[{'id':'C1','local_id':'L1','mesa':3,'total':20000,'propina':2000,'propina_efec':0,'propina_tarj':0,'metodo':'Tarjeta','garzon':'Ana','items':[],'turno_id':'T1','cobrado_por':'Ana','created_at':n}]
    return d
def K7(pg):
    pg.on('dialog',lambda x:x.accept('Efectivo' if 'Forma de pago correcta' in x.message else 'Garzona marcó tarjeta y pagaron en efectivo') if x.type=='prompt' else x.accept())
    nav_caja(pg)
    check('K7: la administradora ve el cobro y el botón Corregir forma de pago', pg.locator('[data-act="cmetodo"]').count()==1 and 'Cobros del turno' in pg.inner_text('#app'))
    pg.click('[data-act="cmetodo"]'); pg.wait_for_timeout(700)
    c=pg.evaluate('window.__DB.resto_cuentas[0]')
    check('K7: el cobro pasa a Efectivo con quién y por qué', c['metodo']=='Efectivo' and c.get('metodo_editado_motivo')=='Garzona marcó tarjeta y pagaron en efectivo' and c.get('metodo_editado_por')=='Administradora' and c['total']==20000)
    pg.evaluate("window.__DB.resto_cuentas[0].metodo_original='Tarjeta'")  # lo hace el trigger de la base real
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('K7: se ve la corrección y el efectivo esperado sube', 'Corregido por Administradora: era Tarjeta' in t and '$120.000' in t)
e=run({'email':'u','role':'','db':db_cobro_mal()},K7,LS_ADM2); print('ERR K7',e)

def K8(pg):
    nav_caja(pg)
    check('K8: el cajero no ve Corregir forma de pago', pg.locator('[data-act="cmetodo"]').count()==0)
e=run({'email':'u','role':'','db':db_cobro_mal()},K8,LS_ANA); print('ERR K8',e)


def K9(pg):
    pg.wait_for_timeout(800)
    t=pg.inner_text('#app')
    check('K9: la administradora ve la opción de activar avisos en el celular', 'Avisos en el celular' in t and pg.locator('[data-act="pushon"]').count()==1)
e=run({'email':'u','role':'','db':db_gasto()},K9,LS_ADM2+"try{Object.defineProperty(Notification,'permission',{get:()=>'default'})}catch(e){}"); print('ERR K9',e)

def K10(pg):
    pg.wait_for_timeout(800)
    check('K10: el garzón no ve los avisos de la administradora', 'Avisos en el celular' not in pg.inner_text('#app') and pg.locator('[data-act="pushon"]').count()==0)
e=run({'email':'u','role':'','db':db_gasto()},K10,LS_ANA); print('ERR K10',e)


def db_prop():
    d=db_roles(); n=(__import__('datetime').datetime.utcnow()-__import__('datetime').timedelta(minutes=5)).isoformat()+'Z'
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Ana','monto_inicial':100000,'abierto_at':n,'created_at':n}]
    d['resto_gastos']=[]
    def c(i,mesa,tot,pro,pe,pt,met,g): return {'id':i,'local_id':'L1','mesa':mesa,'total':tot,'propina':pro,'propina_efec':pe,'propina_tarj':pt,'metodo':met,'garzon':g,'items':[],'turno_id':'T1','cobrado_por':'Ana','created_at':n}
    d['resto_cuentas']=[c('p1',1,20000,2000,0,500,'Tarjeta','Ana'),c('p2',2,10000,1000,300,0,'Efectivo','Luis'),c('p3',0,8000,800,0,0,'Tarjeta',None)]
    return d
def L_(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg)
    t=pg.inner_text('#app')
    check('L: se muestran las propinas por garzón', 'Propinas de los garzones' in t and 'Ana' in t and 'Luis' in t)
    check('L: Ana acumula propina de cuenta y propina extra de tarjeta', '$2.500' in t)
    check('L: Luis acumula su propina y se avisa la directa', '$1.000' in t and 'ya la recibió' in t and '$300' in t)
    check('L: total a pagar en efectivo desde caja', 'Total a pagar en efectivo desde la caja' in t and '$3.500' in t)
    check('L: las propinas sin garzón no se pagan', '$800' in t and 'No se pagan a ningún garzón' in t)
    pg.fill('#dnc-20000','100000'); pg.fill('#dnc-5000','5000'); pg.fill('#dnc-2000','2000'); pg.fill('#dnc-500','500'); pg.fill('#ctarj','31300'); pg.fill('#ctrans','0')
    pg.fill('#dnd-20000','100000'); pg.wait_for_timeout(300)
    c=pg.inner_text('#cuadre')
    # esperado: 100000 inicial + efectivo 11000 (10000+1000) - propinas pagadas 3500 = 107500; contado 107500
    check('L: el efectivo esperado descuenta las propinas pagadas', 'Sistema $107.500' in c and 'propinas pagadas' in c)
    check('L: el efectivo cuadra', c.count('Cuadra')>=1 and 'Falta' not in c.split('Sencillo que queda')[0])
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(900)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('L: el cierre pide confirmar la entrega de propinas', any('Propinas a pagar en efectivo' in m and 'Ana: $2.500' in m for m in d))
    pp=tu.get('pago_propinas') or []
    check('L: el cierre guarda el detalle de propinas pagadas', tu.get('cerrado_at') and tu.get('propinas_pagadas')==3500 and {(x['n'],x['m']) for x in pp}=={('Ana',2500),('Luis',1000)})
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    pg.fill('#dna-20000','100000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(800)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('L: con el turno nuevo las propinas parten en cero', 'Aún no hay propinas acumuladas en este turno' in t and 'Total a pagar en efectivo' not in t)
e=run({'email':'u','role':'','db':db_prop()},L_,LS_ANA); print('ERR L',e)


def L2_(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept('1500')))
    nav_caja(pg)
    pg.click('[data-act="proppag"][data-n="Ana"]'); pg.wait_for_timeout(700)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    g=pg.evaluate('window.__DB.resto_gastos')
    t=pg.inner_text('#app')
    check('L2: el pago de propina queda registrado con el garzón y el monto', len(g)==1 and g[0]['tipo']=='Propina pagada' and g[0]['proveedor']=='Ana' and g[0]['monto']==1500)
    check('L2: se ve lo ya pagado y lo que falta', 'Ya pagado durante el turno' in t and 'falta $1.000' in t and 'Falta pagar al cerrar' in t)
    check('L2: no cuenta como gasto de caja', 'Aún no hay gastos en este turno' in t)
    pg.fill('#dnc-20000','100000'); pg.fill('#dnc-5000','5000'); pg.fill('#dnc-2000','2000'); pg.fill('#dnc-500','500'); pg.fill('#ctarj','31300'); pg.fill('#ctrans','0')
    pg.fill('#dnd-20000','100000'); pg.wait_for_timeout(300)
    c=pg.inner_text('#cuadre')
    check('L2: el efectivo esperado sigue siendo el mismo (no se descuenta dos veces)', 'Sistema $107.500' in c and c.count('Cuadra')>=1)
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(900)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('L2: al cerrar solo se pide pagar lo que falta', any('Propinas a pagar en efectivo desde la caja: $2.000' in m and 'Ana: $1.000 (ya recibió $1.500 antes)' in m and 'Luis: $1.000' in m for m in d))
    pp={x['n']:x for x in (tu.get('pago_propinas') or [])}
    check('L2: el cierre guarda el total y lo adelantado', tu.get('propinas_pagadas')==3500 and pp['Ana']['m']==2500 and pp['Ana'].get('ad')==1500 and pp['Luis']['m']==1000)
e=run({'email':'u','role':'','db':db_prop()},L2_,LS_ANA); print('ERR L2',e)


def db_ins(turno=False):
    d=db_roles(); d['resto_insumos']=[]; d['resto_insumo_mov']=[]; d['resto_gastos']=[]
    if turno:
        n=(__import__('datetime').datetime.utcnow()-__import__('datetime').timedelta(minutes=5)).isoformat()+'Z'
        d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Administradora','monto_inicial':100000,'abierto_at':n,'created_at':n}]
    return d
def M(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept('Se venció')) if x.type=='prompt' else (d.append(x.message),x.accept()))
    tabs=pg.inner_text('header nav')
    check('M: existe la pestaña Inventario de producción', 'Inventario de producción' in tabs)
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('M: la carta aclara que solo van productos de venta', 'solo se agregan productos para la venta' in pg.inner_text('#app'))
    pg.click('[data-act="tab"][data-v="prod"]'); pg.wait_for_timeout(300)
    pg.fill('#i-n','Mermelada de frambuesa'); pg.select_option('#i-u','tarro'); pg.fill('#i-s','10'); pg.fill('#i-min','3'); pg.click('[data-act="insadd"]'); pg.wait_for_timeout(700)
    pg.fill('#i-n','Duraznos en tarro'); pg.select_option('#i-u','tarro'); pg.fill('#i-s','2'); pg.click('[data-act="insadd"]'); pg.wait_for_timeout(700)
    ins=pg.evaluate('window.__DB.resto_insumos')
    check('M: se agregan insumos con unidad, cantidad inicial y mínimo', len(ins)==2 and ins[0]['nombre']=='Mermelada de frambuesa' and ins[0]['unidad']=='tarro' and ins[0]['stock']==10 and ins[0]['stock_min']==3)
    mid=ins[0]['id']
    pg.select_option('#c-ins',mid); pg.fill('#c-q','5'); pg.fill('#c-m','12500'); pg.fill('#c-prov','Distribuidora Sur'); pg.click('[data-act="inscompra"]'); pg.wait_for_timeout(400)
    check('M: la compra exige número de boleta', any('número de la boleta' in m for m in d))
    pg.fill('#c-num','777'); pg.click('[data-act="inscompra"]'); pg.wait_for_timeout(800)
    ins=pg.evaluate('window.__DB.resto_insumos'); mv=pg.evaluate('window.__DB.resto_insumo_mov')
    compra=[m for m in mv if m['motivo']=='compra']
    check('M: la compra suma stock y deja el registro con boleta y proveedor', ins[0]['stock']==15 and len(compra)==1 and compra[0]['numero_doc']=='777' and compra[0]['proveedor']=='Distribuidora Sur' and compra[0]['costo_total']==12500 and ins[0]['costo_unit']==2500)
    check('M: una compra con otro medio no crea gasto de caja', pg.evaluate('window.__DB.resto_gastos.length')==0)
    pg.select_option('#c-ins',mid); pg.fill('#c-q','1'); pg.fill('#c-m','2500'); pg.fill('#c-num','778'); pg.fill('#c-prov','Distribuidora Sur'); pg.select_option('#c-pago','caja'); pg.wait_for_timeout(200)
    pg.fill('#c-q','1'); pg.fill('#c-m','2500'); pg.fill('#c-num','778'); pg.fill('#c-prov','Distribuidora Sur'); pg.select_option('#c-ins',mid); pg.click('[data-act="inscompra"]'); pg.wait_for_timeout(500)
    check('M: no se puede pagar con la caja si está cerrada', any('caja está cerrada' in m for m in d) and len(pg.evaluate('window.__DB.resto_insumo_mov.filter(m=>m.motivo==="compra")'))==1)
    pg.fill(f'#iq-{mid}','4'); pg.click(f'[data-act="insuso"][data-id="{mid}"]'); pg.wait_for_timeout(700)
    check('M: Usó descuenta el stock', pg.evaluate('window.__DB.resto_insumos[0].stock')==11)
    pg.fill(f'#iq-{mid}','50'); pg.click(f'[data-act="insuso"][data-id="{mid}"]'); pg.wait_for_timeout(400)
    check('M: no deja usar más de lo que hay', any('No alcanza' in m for m in d) and pg.evaluate('window.__DB.resto_insumos[0].stock')==11)
    pg.fill(f'#iq-{mid}','1'); pg.click(f'[data-act="insmerma"][data-id="{mid}"]'); pg.wait_for_timeout(700)
    mm=pg.evaluate('window.__DB.resto_insumo_mov.filter(m=>m.motivo==="merma")')
    check('M: la merma descuenta y guarda el motivo', pg.evaluate('window.__DB.resto_insumos[0].stock')==10 and len(mm)==1 and mm[0]['nota']=='Se venció')
    pg.fill(f'#iq-{mid}','2'); pg.click(f'[data-act="inscont"][data-id="{mid}"]'); pg.wait_for_timeout(700)
    check('M: Contar fija lo que realmente hay y avisa que hay que comprar', pg.evaluate('window.__DB.resto_insumos[0].stock')==2 and 'Hay que comprar' in pg.inner_text('#app'))
    check('M: el historial muestra los movimientos', 'Compra' in pg.inner_text('#app') and 'Merma' in pg.inner_text('#app') and 'Boleta N° 777' in pg.inner_text('#app'))
    pg.click(f'[data-act="insoff"][data-id="{mid}"]'); pg.wait_for_timeout(700)
    check('M: Quitar saca el insumo de la lista y conserva los movimientos', 'Mermelada de frambuesa (' not in pg.inner_text('#app').split('Movimientos')[0] and len(pg.evaluate('window.__DB.resto_insumo_mov'))>=4)
e=run({'email':'u','role':'','db':db_ins()},M,LS_ADM2); print('ERR M',e)

def M2(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    pg.click('[data-act="tab"][data-v="prod"]'); pg.wait_for_timeout(300)
    pg.fill('#i-n','Crema pastelera'); pg.select_option('#i-u','kg'); pg.click('[data-act="insadd"]'); pg.wait_for_timeout(700)
    iid=pg.evaluate('window.__DB.resto_insumos[0].id')
    pg.select_option('#c-ins',iid); pg.fill('#c-q','2,5'); pg.fill('#c-m','9000'); pg.select_option('#c-tipo','Factura'); pg.fill('#c-num','9001'); pg.fill('#c-prov','Lácteos del Valle'); pg.select_option('#c-pago','caja'); pg.wait_for_timeout(200)
    pg.fill('#c-q','2,5'); pg.fill('#c-m','9000'); pg.fill('#c-num','9001'); pg.fill('#c-prov','Lácteos del Valle'); pg.select_option('#c-ins',iid)
    pg.click('[data-act="inscompra"]'); pg.wait_for_timeout(900)
    g=pg.evaluate('window.__DB.resto_gastos'); i=pg.evaluate('window.__DB.resto_insumos[0]')
    check('M2: la compra pagada desde caja suma stock con decimales', i['stock']==2.5)
    check('M2: queda como gasto de la caja con factura y detalle', len(g)==1 and g[0]['tipo']=='Factura' and g[0]['numero']=='9001' and g[0]['monto']==9000 and 'Compra de insumo: Crema pastelera' in g[0]['detalle'] and g[0]['turno_id']=='T1')
e=run({'email':'u','role':'','db':db_ins(True)},M2,LS_ADM2); print('ERR M2',e)

def H(pg):
    check('H: garzón sin autorización NO ve Caja', pg.locator('[data-act="tab"][data-v="turno"]').count()==0)
e=run({'email':'u','role':'','db':db_roles(caja=False)},H,LS_ANA); print('ERR H',e)

LS_ADM="localStorage.setItem('pr-rol', JSON.stringify({lid:'L1',rol:'admin',quien:'Administradora',tok:'T',t:Date.now()}));"
def I(pg):
    pg.on('dialog',lambda x:x.accept())
    nav_caja(pg); pg.fill('#dna-20000','20000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(600)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('I: administradora ve el detalle de apertura y el cierre con conteo', '1×$20.000' in t and 'Cerrar caja' in t and 'Efectivo contado' in t)
    pg.fill('#dnc-20000','20000'); pg.fill('#ctarj','0'); pg.fill('#ctrans','0'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(700)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(600)
    check('I: historial muestra sencillo inicial y efectivo contado', 'Sencillo inicial: 1×$20.000' in pg.inner_text('#app') and 'Efectivo contado: 1×$20.000' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':db_roles()},I,LS_ADM); print('ERR I',e)



def N(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.click('[data-act="mesa"][data-n="4"]'); pg.wait_for_timeout(300)
    pg.select_option('#garz','Ana'); pg.wait_for_timeout(200)
    pg.evaluate('window.__OFFLINE=true')
    pg.click('[data-act="inc"][data-id="m1"]'); pg.click('[data-act="inc"][data-id="m1"]'); pg.click('[data-act="enviar"]'); pg.wait_for_timeout(600)
    check('N: sin conexión el pedido se guarda y aparece en pantalla', pg.evaluate('OUT.length')==1 and pg.evaluate('D.comandas.some(c=>c.mesa===4)') and pg.evaluate('window.__DB.resto_comandas.filter(c=>c.mesa===4).length')==0)
    check('N: aviso de sin conexión visible', 'Sin conexión' in pg.inner_text('#offbar'))
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(300)
    check('N: una recarga fallida no hace desaparecer el pedido guardado', pg.evaluate('D.comandas.some(c=>c.mesa===4)'))
    pg.click('[data-act="cerrar"]'); pg.wait_for_timeout(200); pg.click('[data-act="pagar"]'); pg.wait_for_timeout(600)
    check('N: sin conexión el cobro de la mesa también se guarda', pg.evaluate('OUT.length')==2 and pg.evaluate('D.comandas.some(c=>c.mesa===4)')==False)
    pg.evaluate('window.__OFFLINE=false'); pg.evaluate('outVaciar()'); pg.wait_for_timeout(1200)
    db=pg.evaluate('window.__DB')
    com=[c for c in db['resto_comandas'] if c['mesa']==4]; cue=[c for c in db['resto_cuentas'] if c['mesa']==4]
    check('N: al volver internet el pedido llega una sola vez y queda cerrado', len(com)==1 and com[0].get('cerrada')==True and pg.evaluate('OUT.length')==0)
    check('N: al volver internet el cobro llega una sola vez', len(cue)==1 and cue[0]['total']==5000)
    check('N: el stock se descontó una sola vez', len([r for r in pg.evaluate('window.__RPC||[]') if r[0]=='resto_stock_mover'])==1)
    pg.evaluate('outVaciar()'); pg.wait_for_timeout(300)
    check('N: reintentar no duplica', len([c for c in pg.evaluate('window.__DB.resto_cuentas') if c['mesa']==4])==1)
def db_n():
    d=db_ins(True); d['resto_locales'][0]['admin_pin']=''; d['resto_garzones'][0]['pin']=''; return d
e=run({'email':'u','role':'','db':db_n()},N); print('ERR N',e)



import hashlib
def O1(pg):
    check('O: sin sesión pide quién eres', '¿Quién eres?' in pg.inner_text('#app'))
    pg.click('[data-act="qsel"][data-k="admin"]'); pg.wait_for_timeout(200)
    pg.fill('#qpin','0000'); pg.click('[data-act="qok"]'); pg.wait_for_timeout(500)
    check('O: PIN incorrecto se rechaza', 'PIN incorrecto' in pg.inner_text('#app') and pg.evaluate('RTOK')=='')
    pg.fill('#qpin','1234'); pg.click('[data-act="qok"]'); pg.wait_for_timeout(600)
    check('O: PIN correcto entra y guarda el pase del servidor', pg.evaluate('RTOK')=='TOKadmin' and pg.evaluate('S.rol')=='admin' and 'TOKadmin' in pg.evaluate("localStorage.getItem('pr-rol')"))
e=run({'email':'u','role':'','db':db_roles()},O1); print('ERR O1',e)
def O2(pg):
    pg.click('[data-act="qsel"][data-k="admin"]'); pg.wait_for_timeout(200)
    pg.fill('#qpin','1234'); pg.click('[data-act="qok"]'); pg.wait_for_timeout(500)
    check('O2: tras varios intentos el servidor bloquea y la app lo explica', 'Demasiados intentos' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':db_roles(),'bloq':True},O2); print('ERR O2',e)
def O3(pg):
    pg.click('[data-act="qsel"][data-k="admin"]'); pg.wait_for_timeout(200)
    pg.fill('#qpin','1234'); pg.click('[data-act="qok"]'); pg.wait_for_timeout(600)
    check('O3: si la base aún no tiene los pases, entra con la verificación antigua', pg.evaluate('S.rol')=='admin' and pg.evaluate('SIN_PASES')==True)
d3=db_roles(); d3['resto_locales'][0]['admin_pin']=hashlib.sha256(b'L1:admin:1234').hexdigest()
e=run({'email':'u','role':'','db':d3,'noPases':True},O3); print('ERR O3',e)
def O4(pg):
    check('O4: pase vencido en el servidor: vuelve a pedir quién eres', '¿Quién eres?' in pg.inner_text('#app') and pg.evaluate('RTOK')=='')
e=run({'email':'u','role':'','db':db_roles(),'sesionVencida':True},O4,LS_ADM); print('ERR O4',e)
def O5(pg):
    check('O5: sesión guardada sin pase se descarta y pide PIN', '¿Quién eres?' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':db_roles()},O5,"localStorage.setItem('pr-rol', JSON.stringify({lid:'L1',rol:'admin',quien:'Administradora',t:Date.now()}));"); print('ERR O5',e)
def O6(pg):
    pg.click('[data-act="qsel"][data-k="g:Ana"]'); pg.wait_for_timeout(500)
    check('O6: garzón sin PIN entra y recibe pase del servidor', pg.evaluate('S.rol')=='garzon' and pg.evaluate('RTOK')=='TOKgarzon')
d6=db_roles(); d6['resto_garzones'][0]['pin']=''
e=run({'email':'u','role':'','db':d6,'sinPinOk':True},O6); print('ERR O6',e)



def P(pg):
    pg.click('[data-act="tab"][data-v="bit"]'); pg.wait_for_timeout(500)
    t=pg.inner_text('#app')
    check('P: pestaña Registro de cambios muestra quién, qué y cuándo', 'Registro de cambios' in t and 'Administradora' in t and 'precio: $2.500 → $3.000' in t and 'Torta' in t)
    pg.select_option('#bit-t','resto_turnos'); pg.wait_for_timeout(200)
    check('P: se puede filtrar por tipo', 'Torta' not in pg.inner_text('#app'))
def db_p():
    d=db_ins(); d['resto_locales'][0]['admin_pin']=''; d['resto_garzones'][0]['pin']=''
    d['resto_bitacora']=[{'id':1,'local_id':'L1','at':'2026-10-17T03:00:00Z','quien':'Administradora','rol':'admin','tabla':'resto_menu','accion':'UPDATE','fila':'Torta','detalle':{'precio':{'antes':2500,'despues':3000}}}]
    return d
e=run({'email':'u','role':'','db':db_p()},P); print('ERR P',e)



def db_q(roles):
    d=db_ins(True)
    if not roles: d['resto_locales'][0]['admin_pin']=''; d['resto_garzones'][0]['pin']=''
    d['resto_comandas']=[{'id':'cq','local_id':'L1','mesa':5,'items':[{'n':'Café','q':2,'p':2500,'e':'cafeteria'}],'nota':'','estado':'entregado','garzon':'Ana','created_at':iso(10),'cerrada':False}]
    d['resto_cuentas']=[]
    return d
def Q1(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.click('[data-act="mesa"][data-n="5"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="cerrar"]'); pg.wait_for_timeout(300)
    check('Q1: el cobro ofrece descuento y propina del local', 'Aplicar descuento' in pg.inner_text('#app') and 'Propina sugerida 10%' in pg.inner_text('#app'))
    pg.click('[data-act="descabrir"]'); pg.wait_for_timeout(200)
    pg.fill('#d-val','10'); pg.click('[data-act="autok"]'); pg.wait_for_timeout(300)
    t=pg.inner_text('#app')
    check('Q1: la administradora aplica 10% sin PIN y el total baja', 'Descuento 10%' in t and '$4.950' in pg.inner_text('#totpagar'))
    pg.click('[data-act="pagar"]'); pg.wait_for_timeout(700)
    c=pg.evaluate('window.__DB.resto_cuentas')
    check('Q1: la cuenta guarda descuento, motivo y quién autorizó', len(c)==1 and c[0]['total']==4500 and c[0]['propina']==450 and c[0]['descuento']==500 and c[0]['desc_motivo']=='Cortesía de la casa' and c[0]['desc_aut']=='Administradora')
e=run({'email':'u','role':'','db':db_q(False)},Q1); print('ERR Q1',e)
def Q2(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.click('[data-act="mesa"][data-n="5"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="cerrar"]'); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('[data-act=propina]').click()"); pg.wait_for_timeout(300)
    check('Q2: el garzón quita la propina sin pedir autorización', 'necesita autorización' not in pg.inner_text('#app') and pg.evaluate('S.propina')==False and '$5.000' in pg.inner_text('#totpagar'))
    pg.click('[data-act="pagar"]'); pg.wait_for_timeout(700)
    c=pg.evaluate('window.__DB.resto_cuentas'); lg=[r for r in pg.evaluate('window.__RPC') if r[0]=='resto_login' and r[1].get('p_temp')]
    check('Q2: se cobra sin propina sin pase de administradora', len(c)==1 and c[0]['propina']==0 and c[0]['total']==5000 and len(lg)==0)
e=run({'email':'u','role':'','db':db_q(True)},Q2,LS_ANA); print('ERR Q2',e)

def R1(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.click('[data-act="mesa"][data-n="5"]'); pg.wait_for_timeout(300)
    check('R1: la mesa ofrece mover/unir y dividir en partes iguales', 'Mover o unir' in pg.inner_text('#app') and 'por persona' in pg.inner_text('#app'))
    pg.select_option('#mv-mesa','2'); pg.click('[data-act="mover"]'); pg.wait_for_timeout(700)
    c=pg.evaluate('window.__DB.resto_comandas')
    check('R1: los pedidos pasan a la mesa de destino', len(c)==1 and c[0]['mesa']==2 and pg.evaluate('S.mesa')==2)
    pg.fill('#nota','x'); 
def R2(pg):
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    pg.evaluate("S.cart={}; var m=L().menu[0]; S.cart[m.id]=1; render()"); pg.wait_for_timeout(300)
    check('R2: las opciones rápidas del producto aparecen como botones', pg.locator('[data-act="opc"]').count()>=2)
    pg.click('[data-act="opc"]'); pg.wait_for_timeout(200)
    check('R2: tocar una opción la agrega a la nota de cocina', pg.evaluate('S.note').strip()!='')
def db_r():
    d=db_q(False)
    d['resto_menu'][0]['opciones']='sin cebolla, bien cocido'
    return d
e=run({'email':'u','role':'','db':db_q(False)},R1); print('ERR R1',e)
e=run({'email':'u','role':'','db':db_r()},R2); print('ERR R2',e)

def db_s():
    d=db_q(False)
    d['resto_insumos']=[{'id':'I1','local_id':'L1','nombre':'Harina','unidad':'kg','stock':2,'stock_min':5,'costo_unit':None,'activo':True,'vence':None,'created_at':iso(10)}]
    d['resto_insumo_mov']=[]; d['resto_recetas']=[]; d['resto_proveedores']=[]; d['resto_ordenes_compra']=[]
    return d
def S1(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.evaluate("S.view='abast'; render()"); pg.wait_for_timeout(300)
    check('S1: existe la pestaña Compras y recetas con conteo guiado', 'Compras y recetas' in pg.inner_text('#app') and 'Conteo físico guiado' in pg.inner_text('#app'))
    pg.fill('#pv-n','Molino Sur'); pg.fill('#pv-t','56911112222'); pg.click('[data-act="pvadd"]'); pg.wait_for_timeout(600)
    check('S1: se agrega un proveedor', len(pg.evaluate('window.__DB.resto_proveedores'))==1)
    pg.select_option('#oc-pv','Molino Sur'); pg.click('[data-act="ocnueva"]'); pg.wait_for_timeout(600)
    o=pg.evaluate('window.__DB.resto_ordenes_compra')
    check('S1: la orden de compra incluye el insumo bajo el mínimo', len(o)==1 and o[0]['items'][0]['n']=='Harina' and 'wa.me/56911112222' in pg.inner_html('#app'))
    pg.select_option('#r-m',index=1); pg.select_option('#r-i','I1'); pg.fill('#r-q','0.2'); pg.click('[data-act="recadd"]'); pg.wait_for_timeout(600)
    check('S1: se guarda la receta', len(pg.evaluate('window.__DB.resto_recetas'))==1)
    pg.fill('#cg-I1','7'); pg.click('[data-act="cgapl"]'); pg.wait_for_timeout(700)
    ins=pg.evaluate('window.__DB.resto_insumos')[0]
    check('S1: el conteo ajusta el stock a lo contado', ins['stock']==7 and len(pg.evaluate('window.__DB.resto_insumo_mov'))==1)
e=run({'email':'u','role':'','db':db_s()},S1); print('ERR S1',e)

def T1(pg):
    pg.on('dialog',lambda x:x.accept())
    pg.click('header nav >> text=Resumen'); pg.wait_for_timeout(900)
    t=pg.inner_text('#app')
    check('T1: el resumen muestra ventas, comparación y botones de exportar', 'Resumen del dueño' in t and 'Ventas' in t and 'Descargar Excel' in t and 'Imprimir' in t and 'WhatsApp' in t)
    pg.click('[data-act="rsp"][data-p="7"]'); pg.wait_for_timeout(900)
    check('T1: se puede cambiar de período', 'Últimos 7 días' in pg.inner_text('#app'))
    with pg.expect_download() as dl: pg.click('[data-act="rsxls"]')
    check('T1: descarga el Excel (CSV) de ventas', dl.value.suggested_filename.endswith('.csv'))
    with pg.expect_download() as dl2: pg.click('[data-act="respaldo"]')
    check('T1: descarga el respaldo sin PIN', dl2.value.suggested_filename.startswith('respaldo_') and 'admin_pin' not in open(dl2.value.path()).read())
e=run({'email':'u','role':'','db':db_s()},T1); print('ERR T1',e)

def db_prop2():
    d=db_prop()
    n=d['resto_cuentas'][0]['created_at']
    def c(i,mesa,tot,pro,pe,pt,met,g,pq): return {'id':i,'local_id':'L1','mesa':mesa,'total':tot,'propina':pro,'propina_efec':pe,'propina_tarj':pt,'propina_efec_caja':pq,'metodo':met,'garzon':g,'items':[],'turno_id':'T1','cobrado_por':'Ana','created_at':n}
    d['resto_cuentas']=[c('p1',1,20000,2000,0,500,'Tarjeta','Ana',False),c('p2',2,10000,1000,300,0,'Efectivo','Luis',True),c('p3',3,5000,0,200,0,'Efectivo','Luis',False)]
    return d
def M_(pg):
    pg.click('[data-act="tab"][data-v="garz"]'); pg.wait_for_timeout(800)
    t=pg.inner_text('#app')
    check('M: Garzones separa tarjeta, efectivo en caja y directo en mano', 'Propinas por garzón' in t and '💳' in t and '💵' in t and '🤝' in t)
    check('M: Ana recibe $2.500 por tarjeta', 'Tarjeta o transferencia $2.500' in t)
    check('M: Luis tiene $1.300 en caja y $200 directo', 'Efectivo en caja $1.300' in t and 'Directo en mano $200' in t)
    check('M: total a pagar desde la caja = $3.800', 'Total a pagar desde la caja' in t and '$3.800' in t)
    check('M: total propinas $4.000', 'Total propinas' in t and '$4.000' in t)
e=run({'email':'u','role':'','db':db_prop2()},M_,LS_ADM2); print('ERR M',e)

def db_prop0(con_retiro=False):
    d=db_prop(); d['resto_cuentas']=[]; n=d['resto_turnos'][0]['created_at']
    if con_retiro: d['resto_gastos']=[{'id':'r1','local_id':'L1','turno_id':'T1','tipo':'Retiro','numero':None,'proveedor':'Retiro de efectivo','detalle':'Depósito al banco','monto':30000,'registrado_por':'Administradora','created_at':n}]
    return d

def R1(pg):
    d=[]; pg.on('dialog',lambda x:(d.append(x.message),x.accept()))
    nav_caja(pg)
    t=pg.inner_text('#app')
    check('R1: la administradora ve el formulario de retiros', 'Retiros de efectivo de la caja' in t and pg.locator('#r-monto').count()==1)
    pg.click('[data-act="retiro"]'); pg.wait_for_timeout(300)
    check('R1: pide monto antes de registrar el retiro', any('monto' in m for m in d) and not pg.evaluate('window.__DB.resto_gastos'))
    pg.fill('#r-monto','30000'); pg.fill('#r-mot','Depósito al banco'); pg.click('[data-act="retiro"]'); pg.wait_for_timeout(700)
    g=pg.evaluate('window.__DB.resto_gastos')
    check('R1: el retiro queda registrado como movimiento de caja', len(g)==1 and g[0]['tipo']=='Retiro' and g[0]['monto']==30000 and g[0]['detalle']=='Depósito al banco')
    t=pg.inner_text('#app')
    check('R1: se muestra el total retirado', 'Total retirado en el turno' in t and '$30.000' in t)
    check('R1: el efectivo esperado descuenta el retiro', 'Retiros de la administradora' in t and 'Sistema $70.000' not in t and '$70.000' in t)
    check('R1: el retiro no aparece como gasto con boleta', 'Total gastos del turno' not in t)
    pg.fill('#dnc-20000','60000'); pg.fill('#dnc-10000','10000'); pg.wait_for_timeout(300)
    c=pg.inner_text('#cuadre')
    check('R1: el cuadre avisa que la caja cuadra', '¡La caja cuadra!' in c and 'de retiros' in c)
    pg.fill('#dnc-10000','20000'); pg.wait_for_timeout(300)
    check('R1: el cuadre avisa si hay diferencias', 'tiene diferencias' in pg.inner_text('#cuadre'))
e=run({'email':'u','role':'','db':db_prop0()},R1,LS_ADM2); print('ERR R1',e)

def R2(pg):
    nav_caja(pg)
    t=pg.inner_text('#app')
    check('R2: el cajero ve los retiros pero no puede registrarlos', 'Retiros de efectivo de la caja' in t and 'Depósito' in t and pg.locator('#r-monto').count()==0)
e=run({'email':'u','role':'','db':db_prop0(True)},R2,LS_ANA); print('ERR R2',e)

def A1(pg):
    pg.evaluate("1"); nav_caja(pg)
    pg.fill('#dna-20000','100000'); pg.wait_for_timeout(300)
    t=pg.inner_text('#aper')
    check('A1: la apertura muestra con cuánto se abre', 'Abres con $100.000' in t)
e=run({'email':'u','role':'','db':dict(db_roles(),**{})},A1,LS_ANA); print('ERR A1',e)


# --- CORTE: cerrar solo hasta el final de ayer cuando el turno quedó abierto y hoy ya hay ventas
def corte_db():
    d=db_roles(); mid=datetime.datetime.now().replace(hour=0,minute=0,second=0,microsecond=0).astimezone(datetime.timezone.utc).replace(tzinfo=None)
    f=lambda dt:dt.isoformat()+'Z'
    ayer=lambda h:f(mid-datetime.timedelta(hours=h)); hoy=lambda m:f(mid+datetime.timedelta(minutes=m))
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Administradora','abierto_at':ayer(20),'monto_inicial':100000,'cerrado_at':None}]
    mk=lambda i,tot,met,ts,**k:dict({'id':i,'local_id':'L1','mesa':2,'total':tot,'propina':0,'propina_efec':0,'propina_tarj':0,'metodo':met,'garzon':'Ana','items':[],'turno_id':'T1','cobrado_por':'Ana','created_at':ts},**k)
    d['resto_cuentas']=[mk('a1',10000,'Efectivo',ayer(5)),mk('a2',20000,'Tarjeta',ayer(3)),mk('h1',7000,'Efectivo',hoy(1)),mk('h2',9000,'Tarjeta',hoy(2))]
    d['resto_gastos']=[{'id':'g1','local_id':'L1','turno_id':'T1','tipo':'Factura','numero':'1','proveedor':'Mayorista','detalle':'Avena','monto':2000,'registrado_por':'Ana','created_at':ayer(4)},
                       {'id':'g2','local_id':'L1','turno_id':'T1','tipo':'Retiro','numero':None,'proveedor':'Retiro de efectivo','detalle':'depósito','monto':50000,'registrado_por':'Administradora','created_at':hoy(1)}]
    d['resto_sesiones']=[{'id':'s1','local_id':'L1','turno_id':'T1','usuario':'Ana','rol':'garzon','entrada':ayer(19),'salida':None}]
    return d
def CORTE(pg):
    pg.on('dialog',lambda x:x.accept()); nav_caja(pg)
    t=pg.inner_text('#app')
    check('CORTE: sin corte el turno incluye ayer y hoy (4 cuentas)', 'Cuentas\n4' in t.replace(' ','') or '4' in pg.inner_text('.stats'))
    check('CORTE: la administradora ve el selector de corte', pg.locator('#c-corte').count()==1)
    opts=pg.eval_on_selector_all('#c-corte option','o=>o.map(x=>x.value)')
    check('CORTE: ofrece cerrar hasta el día de ayer', len(opts)==2 and opts[0]=='' and opts[1]!='')
    pg.select_option('#c-corte',opts[1]); pg.wait_for_timeout(300)
    t=pg.inner_text('#app'); st=pg.inner_text('.stats')
    check('CORTE: con corte solo cuenta lo de ayer (2 cuentas, $30.000)', '2' in st and '$30.000' in st and '$7.000' not in t)
    check('CORTE: efectivo esperado hasta el corte = 100.000 + 10.000 - 2.000', 'Debe haber $108.000' in t or '$108.000' in t)
    check('CORTE: el retiro de hoy no aparece en el cierre de ayer', 'Retiro de efectivo' not in pg.inner_text('#app').split('Retiros de efectivo de la caja')[1].split('Propinas de los garzones')[0] or '$50.000' not in pg.inner_text('#app').split('Retiros de efectivo de la caja')[1].split('Propinas de los garzones')[0])
    pg.fill('#dnc-20000','100000'); pg.fill('#dnc-5000','5000'); pg.fill('#dnc-2000','2000'); pg.fill('#dnc-1000','1000'); pg.fill('#ctarj','20000'); pg.fill('#ctrans','0')
    pg.fill('#dnd-20000','100000'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(900)
    T=pg.evaluate('window.__DB.resto_turnos'); old=[x for x in T if x['id']=='T1'][0]; new=[x for x in T if x['id']!='T1']
    check('CORTE: el turno viejo queda cerrado en el corte', old['cerrado_at'] is not None and old['ventas_total']==30000 and old['cuentas']==2 and old['esperado_efectivo']==108000)
    check('CORTE: se abre un turno nuevo con el sencillo que quedó', len(new)==1 and new[0]['cerrado_at'] is None and new[0]['monto_inicial']==100000 and new[0]['abierto_at']==old['cerrado_at'])
    cu={c['id']:c['turno_id'] for c in pg.evaluate('window.__DB.resto_cuentas')}; ga={g['id']:g['turno_id'] for g in pg.evaluate('window.__DB.resto_gastos')}
    check('CORTE: lo de ayer queda en el turno cerrado y lo de hoy pasa al nuevo', cu['a1']=='T1' and cu['a2']=='T1' and cu['h1']==new[0]['id'] and cu['h2']==new[0]['id'] and ga['g1']=='T1' and ga['g2']==new[0]['id'])
    check('CORTE: no se pierde ningún cobro ni gasto', len(cu)==4 and len(ga)==2)
    pg.evaluate("(async()=>{await cargar();render();})()"); pg.wait_for_timeout(500)
    t=pg.inner_text('#app'); st=pg.inner_text('.stats')
    check('CORTE: el turno nuevo muestra solo lo de hoy ($16.000, 2 cuentas)', '$16.000' in st and 'turno de la' in t.lower())
e=run({'email':'u','role':'','db':corte_db()},CORTE,LS_ADM); print('ERR CORTE',e)
def CORTE2(pg):
    pg.on('dialog',lambda x:x.accept()); nav_caja(pg)
    opts=pg.eval_on_selector_all('#c-corte option','o=>o.map(x=>x.value)'); pg.select_option('#c-corte',opts[1]); pg.wait_for_timeout(200)
    pg.fill('#dnc-20000','100000'); pg.fill('#dnd-20000','100000'); pg.fill('#ctarj','20000'); pg.fill('#ctrans','0'); pg.fill('#tnota','prueba'); pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(700)
    T=pg.evaluate('window.__DB.resto_turnos')
    check('CORTE2: sin la migración 025 no se cierra nada y avisa', len(T)==1 and T[0]['cerrado_at'] is None)
e=run({'email':'u','role':'','db':corte_db(),'sinCorte':True},CORTE2,LS_ADM); print('ERR CORTE2',e)

# --- TRAMOS: Resto se activa por etapas (1 salir a vender · 2 cuadrar el día · 3 control del local · 4 producción y costos)
def tramo_db(n):
    d=db_roles()
    if n is not None: d['resto_locales'][0]['tramo']=n
    return d
tabsx=lambda pg: pg.eval_on_selector_all('nav button[data-act="tab"]','b=>b.map(x=>x.innerText.trim())')
hay=lambda t,n: any(x==n or x.startswith(n+' ⚠') for x in t)  # el nombre puede llevar una insignia ⚠
def TR1(pg):
    t=tabsx(pg)
    check('TRAMOS: en el tramo 2 la administradora ve Caja sin candado', 'Caja' in t and '🔒 Caja' not in t)
    check('TRAMOS: Inventario queda abierto en el tramo 2 y Reservas con candado (tramo 3)', hay(t,'Inventario') and not hay(t,'🔒 Inventario') and hay(t,'🔒 Reservas'))
    check('TRAMOS: Inventario de producción y Compras con candado (tramo 4)', hay(t,'🔒 Inventario de producción') and hay(t,'🔒 Compras y recetas'))
    pg.click('[data-act="tab"][data-v="prod"]'); pg.wait_for_timeout(300)
    x=pg.inner_text('#app')
    check('TRAMOS: la pestaña bloqueada explica el tramo y no muestra el contenido', 'se activa en el tramo 4' in x and 'Pedir a Protech' in x and 'Agregar insumo' not in x)
    check('TRAMOS: el aviso muestra los 4 tramos con su estado', x.count('Tramo ')>=4 and '✅' in x and '🔒' in x)
    pg.click('[data-act="tab"][data-v="resv"]'); pg.wait_for_timeout(300)
    check('TRAMOS: Reservas dice tramo 3', 'se activa en el tramo 3' in pg.inner_text('#app'))
    nav_caja(pg)
    check('TRAMOS: Caja sí funciona en el tramo 2', 'se activa' not in pg.inner_text('#app') and 'Sencillo de partida' in pg.inner_text('#app'))
    check('TRAMOS: la administradora no ve el selector de tramos', pg.locator('#tramo-sel').count()==0)
e=run({'email':'u','role':'','db':tramo_db(2)},TR1,LS_ADM); print('ERR TR1',e)
def TR2(pg):
    t=tabsx(pg)
    check('TRAMOS: el garzón con caja no ve la pestaña Caja si el tramo es 1', 'Caja' not in t and '🔒 Caja' not in t)
    check('TRAMOS: el garzón ve solo Mesas', t==['Mesas'] or t==['Mesas', 'Admin Protech'][:1])
e=run({'email':'u','role':'','db':tramo_db(1)},TR2,LS_ANA); print('ERR TR2',e)
def TR3(pg):
    pg.click('[data-act="qsel"][data-k="ing"]'); pg.wait_for_timeout(200); pg.fill('#qpin','ing'); pg.click('[data-act="qok"]'); pg.wait_for_timeout(600)
    t=tabsx(pg)
    check('TRAMOS: el ingeniero ve todas las pestañas aunque estén bloqueadas', hay(t,'🔒 Inventario de producción') and hay(t,'🔒 Caja'))
    pg.click('[data-act="tab"][data-v="prod"]'); pg.wait_for_timeout(300)
    x=pg.inner_text('#app')
    check('TRAMOS: el ingeniero ve el contenido y el aviso de bloqueo', 'bloqueada para la administradora' in x and 'se activa en el tramo' not in x)
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('TRAMOS: el ingeniero ve el selector de tramos', pg.locator('#tramo-sel').count()==1)
    pg.select_option('#tramo-sel','4'); pg.click('[data-act="settramo"]'); pg.wait_for_timeout(500)
    check('TRAMOS: guardar el tramo lo escribe en la base', pg.evaluate('window.__DB.resto_locales[0].tramo')==4)
e=run({'email':'u','role':'','db':tramo_db(1)},TR3); print('ERR TR3',e)
def TR4(pg):
    t=tabsx(pg)
    check('TRAMOS: un local sin tramo definido ve todo abierto, sin candados', not any('🔒' in x for x in t) and hay(t,'Inventario de producción'))
    check('TRAMOS: sin tramo no aparece la tarjeta de primeros pasos', 'Primeros pasos' not in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':tramo_db(None)},TR4,LS_ADM); print('ERR TR4',e)
def TR5(pg):
    x=pg.inner_text('#app')
    check('TRAMOS: la administradora del tramo 1 ve los primeros pasos', 'Primeros pasos · tramo 1' in x and 'Cargar la carta' in x)
    check('TRAMOS: marca como hecho lo que ya está (carta cargada y PIN creado)', x.count('✅')>=2 and '⬜' in x)
def tramo_nuevo():
    d=tramo_db(1); d['resto_cuentas']=[]; d['resto_garzones'][0]['pin']=''   # local recién partiendo: carta y PIN listos, falta lo demás
    return d
e=run({'email':'u','role':'','db':tramo_nuevo()},TR5,LS_ADM); print('ERR TR5',e)
def TR6(pg):
    check('TRAMOS: con todos los pasos hechos la tarjeta desaparece', 'Primeros pasos' not in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':tramo_db(1)},TR6,LS_ADM); print('ERR TR6',e)

# ---- Robi, el robot guía de caja ----
def robi_db(tr):
    d=tramo_db(tr); d['resto_locales'][0]['fondo_caja']=160000; d['resto_turnos']=[]; return d
def RB1(pg):
    nav_caja(pg)
    check('ROBI: aparece en la Caja del tramo 2 y saluda con el sencillo a recibir', pg.locator('#robi').count()==1 and 'Debes recibir $160.000' in pg.inner_text('#robi'))
    check('ROBI: dibuja al robot (SVG) y ofrece Escuchar', pg.locator('#robi svg.robi-svg').count()==1)
    pg.fill('#dna-20000','100000'); pg.wait_for_timeout(200)
    t=pg.inner_text('#robi')
    check('ROBI: si el sencillo no coincide avisa cuánto falta', 'faltan $60.000' in t and pg.locator('#robi.aviso').count()==1)
    pg.fill('#dna-20000','160000'); pg.wait_for_timeout(200)
    check('ROBI: si coincide celebra y manda a abrir la caja', 'Perfecto' in pg.inner_text('#robi') and pg.locator('#robi.ok').count()==1)
    pg.click('[data-act="robi-ocultar"]'); pg.wait_for_timeout(200)
    check('ROBI: se puede ocultar y llamar de nuevo', pg.locator('#robi').count()==0 and 'Llamar a Robi' in pg.inner_text('#app'))
    pg.click('[data-act="robi-mostrar"]'); pg.wait_for_timeout(200)
    check('ROBI: vuelve al llamarlo', pg.locator('#robi').count()==1)
e=run({'email':'u','role':'','db':robi_db(2)},RB1,LS_ADM); print('ERR RB1',e)
def RB2(pg):
    nav_caja(pg)
    check('ROBI: también ayuda en un local con todo abierto (tramo 4)', pg.locator('#robi').count()==1)
e=run({'email':'u','role':'','db':robi_db(4)},RB2,LS_ADM); print('ERR RB2',e)
def RB3(pg):
    nav_caja(pg); pg.fill('#dna-20000','160000'); pg.click('[data-act="tabrir"]'); pg.wait_for_timeout(700)
    check('ROBI: con la caja abierta explica que guiará el cierre', 'Turno de la' in pg.inner_text('#robi'))
    pg.fill('#dnc-20000','100000'); pg.wait_for_timeout(200)
    t=pg.inner_text('#robi')
    check('ROBI: en el cierre avisa la diferencia de efectivo', 'En efectivo' in t and pg.locator('#robi.mal').count()==1)
    pg.fill('#dnc-20000','160000'); pg.fill('#ctarj','0'); pg.fill('#ctrans','0'); pg.fill('#dnd-20000','160000'); pg.wait_for_timeout(250)
    check('ROBI: cuando todo cuadra dice que puede cerrar', 'Todo cuadra' in pg.inner_text('#robi') and pg.locator('#robi.ok').count()==1)
e=run({'email':'u','role':'','db':robi_db(2)},RB3,LS_ADM); print('ERR RB3',e)

def RB4(pg):
    nav_caja(pg)
    b0=pg.evaluate("(()=>{const r=document.getElementById('robi').getBoundingClientRect();return [r.right,r.bottom]})()")
    cx,cy=pg.evaluate("(()=>{const r=document.querySelector('#robi .robi-cara').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
    pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx-200,cy-150,steps=8); pg.mouse.up(); pg.wait_for_timeout(200)
    b1=pg.evaluate("(()=>{const r=document.getElementById('robi').getBoundingClientRect();return [r.right,r.bottom]})()")
    check('ROBI: se puede arrastrar con el mouse', b1[0]<b0[0]-150 and b1[1]<b0[1]-100)
    check('ROBI: arrastrar no lo esconde ni cambia el globo', pg.locator('#robi.min').count()==0)
    pg.evaluate("render()"); pg.wait_for_timeout(200)
    b2=pg.evaluate("(()=>{const r=document.getElementById('robi').getBoundingClientRect();return [r.right,r.bottom]})()")
    check('ROBI: recuerda dónde lo dejaron', abs(b2[0]-b1[0])<3 and abs(b2[1]-b1[1])<3)
e=run({'email':'u','role':'','db':robi_db(2)},RB4,LS_ADM); print('ERR RB4',e)

# --- MX: pago mixto (efectivo + tarjeta) en la venta por mostrador
def mx_db():
    d=base_db(); d['resto_cuentas']=[]
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Administradora','abierto_at':iso(120),'monto_inicial':50000,'cerrado_at':None}]
    return d
def MX1(pg):
    pg.click('[data-act="mostrador"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="inc"][data-id="m1"]'); pg.click('[data-act="inc"][data-id="m1"]'); pg.wait_for_timeout(200)
    check('MX: la forma de pago ofrece Mixto', pg.locator('#metodo option[value="Mixto"]').count()==1)
    pg.select_option('#metodo','Mixto'); pg.wait_for_timeout(200)
    check('MX: Mixto pide cuánto paga en efectivo', pg.locator('#mxe').count()==1 and pg.locator('#recib').count()==1)
    pg.fill('#mxe','2000'); pg.fill('#recib','5000'); pg.wait_for_timeout(200)
    check('MX: el resto va con tarjeta ($3.000) y el vuelto es sobre el efectivo ($3.000)', pg.inner_text('#mxtj')=='$3.000' and pg.inner_text('#vuelto')=='$3.000')
    pg.fill('#mxe','5000'); pg.wait_for_timeout(200)
    pg.once('dialog',lambda d: (setattr(pg,'_dlg',d.message), d.accept()))
    pg.click('[data-act="mospagar"]'); pg.wait_for_timeout(500)
    check('MX: no deja cobrar mixto si el efectivo cubre todo el total', 'pago mixto' in (getattr(pg,'_dlg','') or '').lower() and len(pg.evaluate('window.__DB.resto_cuentas'))==0)
    pg.fill('#mxe','2000'); pg.fill('#recib','5000'); pg.wait_for_timeout(200)
    pg.click('[data-act="mospagar"]'); pg.wait_for_timeout(900)
    c=pg.evaluate('window.__DB.resto_cuentas')
    check('MX: se guarda como Mixto con la parte en efectivo', len(c)==1 and c[0]['metodo']=='Mixto' and c[0]['pago_efec']==2000 and c[0]['total']==5000)
    nav_caja(pg); pg.wait_for_timeout(400)
    t=pg.inner_text('#app')
    check('MX: la caja reparte el cobro entre efectivo y tarjeta', 'Efectivo\n$2.000' in t.replace(' ','\n').replace('\n\n','\n') or ('$2.000' in t and '$3.000' in t))
    check('MX: el efectivo esperado suma solo la parte en efectivo', '$52.000' in t)
    check('MX: el cobro del turno muestra el detalle', 'Mixto ($2.000 efectivo + $3.000 tarjeta)' in t)
e=run({'email':'u','role':'','db':mx_db()},MX1,LS_ADM); print('ERR MX1',e)

# --- TT: ventas de tortas (encargos con abonos y calendario)
def tt_db():
    d=base_db(); d['resto_cuentas']=[]
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Administradora','abierto_at':iso(120),'monto_inicial':50000,'cerrado_at':None}]
    return d
def TT1(pg):
    t=tabsx(pg)
    check('TT: existe la pestaña Ventas de tortas', hay(t,'Ventas de tortas'))
    pg.click('[data-act="tab"][data-v="tortas"]'); pg.wait_for_timeout(300)
    check('TT: muestra calendario y formulario del encargo', pg.locator('.cal-d').count()>=28 and pg.locator('#tn').count()==1 and pg.locator('#tt').count()==1)
    manana=pg.evaluate("fechaIso(new Date(Date.now()+864e5))")
    pg.fill('#tn','María Soto'); pg.fill('#tt','912345678'); pg.fill('#td','Torta de mil hojas 20 personas'); pg.fill('#tf',manana); pg.fill('#th','15:30'); pg.fill('#tp','40000'); pg.fill('#ta','10000')
    pg.click('[data-act="tqcrear"]'); pg.wait_for_timeout(800)
    tr=pg.evaluate('window.__DB.resto_tortas'); ab=pg.evaluate('window.__DB.resto_tortas_abonos')
    check('TT: guarda el encargo con los datos del cliente', len(tr)==1 and tr[0]['cliente']=='María Soto' and tr[0]['telefono']=='912345678' and tr[0]['precio']==40000)
    check('TT: el abono inicial queda en el turno abierto', len(ab)==1 and ab[0]['monto']==10000 and ab[0]['metodo']=='Efectivo' and ab[0]['turno_id']=='T1' and ab[0]['torta_id']==tr[0]['id'])
    x=pg.inner_text('#app')
    check('TT: la lista muestra el saldo y el teléfono', 'Saldo $30.000' in x and 'Abonado $10.000' in x and '912345678' in x and 'María Soto' in x)
    check('TT: el calendario marca el día de entrega', pg.locator('.cal-d.con').count()==1)
    pg.click('[data-act="tqabrir"]'); pg.fill('#tab-m','5000'); pg.select_option('#tab-mt','Tarjeta'); pg.click('[data-act="tqabok"]'); pg.wait_for_timeout(800)
    check('TT: segundo abono con tarjeta', len(pg.evaluate('window.__DB.resto_tortas_abonos'))==2 and 'Saldo $25.000' in pg.inner_text('#app'))
    pg.click('[data-act="tqretabrir"]'); pg.wait_for_timeout(200)
    pg.fill('#tr-rc','30000'); pg.wait_for_timeout(200)
    check('TT: al retirar calcula el vuelto del saldo', pg.inner_text('#tr-vuelto')=='$5.000')
    pg.click('[data-act="tqretok"]'); pg.wait_for_timeout(900)
    cu=pg.evaluate('window.__DB.resto_cuentas'); tr=pg.evaluate('window.__DB.resto_tortas')[0]
    check('TT: el saldo se cobra como venta en efectivo', len(cu)==1 and cu[0]['total']==25000 and cu[0]['metodo']=='Efectivo' and cu[0]['turno_id']=='T1')
    check('TT: la torta queda retirada', tr['estado']=='retirada' and tr['cuenta_id']==cu[0]['id'])
    nav_caja(pg); pg.wait_for_timeout(400)
    x=pg.inner_text('#app')
    check('TT: la caja suma abonos y saldo (efectivo $50.000+$10.000+$25.000)', '$85.000' in x and 'Incluye $15.000 en abonos de tortas' in x)
e=run({'email':'u','role':'','db':tt_db()},TT1,LS_ADM); print('ERR TT1',e)

def TT2(pg):
    pg.click('[data-act="tab"][data-v="tortas"]'); pg.wait_for_timeout(300)
    manana=pg.evaluate("fechaIso(new Date(Date.now()+864e5))")
    pg.fill('#tn','Ana Pérez'); pg.fill('#td','Torta tres leches'); pg.fill('#tf',manana); pg.fill('#th','12:00'); pg.fill('#tp','40000'); pg.fill('#ta','10000')
    check('TT2: el abono inicial ofrece Mixto', pg.locator('#tam option[value="Mixto"]').count()==1)
    pg.select_option('#tam','Mixto'); pg.wait_for_timeout(200); pg.fill('#tae','4000'); pg.wait_for_timeout(200)
    check('TT2: el abono inicial muestra la parte con tarjeta', pg.inner_text('#tae-tj')=='$6.000')
    pg.click('[data-act="tqcrear"]'); pg.wait_for_timeout(800)
    ab=pg.evaluate('window.__DB.resto_tortas_abonos')
    check('TT2: el abono inicial queda mixto', len(ab)==1 and ab[0]['metodo']=='Mixto' and ab[0]['pago_efec']==4000 and ab[0]['monto']==10000)
    check('TT2: la lista muestra el detalle del abono mixto', 'Mixto ($4.000 efectivo + $6.000 tarjeta)' in pg.inner_text('#app'))
    pg.click('[data-act="tqabrir"]'); pg.fill('#tab-m','5000'); pg.select_option('#tab-mt','Mixto'); pg.wait_for_timeout(200); pg.fill('#tab-e','5000'); pg.wait_for_timeout(200)
    pg.once('dialog',lambda d: (setattr(pg,'_dlg',d.message), d.accept()))
    pg.click('[data-act="tqabok"]'); pg.wait_for_timeout(500)
    check('TT2: no deja un abono mixto sin parte con tarjeta', 'Pago mixto' in (getattr(pg,'_dlg','') or '') and len(pg.evaluate('window.__DB.resto_tortas_abonos'))==1)
    pg.click('[data-act="tqabno"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="tqretabrir"]'); pg.select_option('#tr-mt','Mixto'); pg.wait_for_timeout(300)
    pg.fill('#tr-e','10000'); pg.fill('#tr-rc','15000'); pg.wait_for_timeout(300)
    check('TT2: al retirar muestra la tarjeta ($20.000) y el vuelto sobre el efectivo ($5.000)', pg.inner_text('#tr-tj')=='$20.000' and pg.inner_text('#tr-vuelto')=='$5.000')
    pg.click('[data-act="tqretok"]'); pg.wait_for_timeout(900)
    cu=pg.evaluate('window.__DB.resto_cuentas')
    check('TT2: el saldo queda como cobro mixto', len(cu)==1 and cu[0]['metodo']=='Mixto' and cu[0]['pago_efec']==10000 and cu[0]['total']==30000)
    nav_caja(pg); pg.wait_for_timeout(400)
    x=pg.inner_text('#app')
    check('TT2: la caja reparte abono y saldo (efectivo $64.000 esperado)', '$64.000' in x and 'Incluye $10.000 en abonos de tortas' in x)
e=run({'email':'u','role':'','db':tt_db()},TT2,LS_ADM); print('ERR TT2',e)

# --- DUP: no cobrar dos veces lo mismo (mesa cobrada y luego repetida por mostrador / cobro desde otro equipo)
def dup_db():
    d=mx_db()
    d['resto_comandas']=[{'id':'c1','local_id':'L1','mesa':3,'items':[{'n':'Café','q':2,'p':2500,'e':'cafeteria'}],'nota':'','estado':'entregado','garzon':'Ana','created_at':iso(20),'cerrada':False}]
    return d
def cobra_mesa3(pg):
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="cerrar"]'); pg.wait_for_timeout(200); pg.click('[data-act="pagar"]'); pg.wait_for_timeout(900)
def DUP1(pg):
    msgs=[]; resp={'ok':False}
    pg.on('dialog',lambda d:(msgs.append(d.message), d.accept() if resp['ok'] else d.dismiss()))
    cobra_mesa3(pg)
    cu=pg.evaluate('window.__DB.resto_cuentas')
    check('DUP: la mesa 3 queda cobrada una vez', len(cu)==1 and cu[0]['mesa']==3 and cu[0]['total']==5000)
    pg.click('[data-act="mostrador"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="inc"][data-id="m1"]'); pg.click('[data-act="inc"][data-id="m1"]'); pg.wait_for_timeout(200)
    n0=pg.inner_text('body').count('Cobrado')
    pg.click('[data-act="mospagar"]'); pg.wait_for_timeout(700)
    check('DUP: al repetir lo mismo por mostrador avisa que ya se cobró en la Mesa 3', any('Mesa 3' in m and 'ya se cobraron' in m for m in msgs))
    check('DUP: si la cajera cancela, no se cobra de nuevo', len(pg.evaluate('window.__DB.resto_cuentas'))==1)
    check('DUP: tampoco muestra un nuevo aviso "Cobrado" cuando se canceló', pg.inner_text('body').count('Cobrado')==n0)
    resp['ok']=True
    pg.click('[data-act="mospagar"]'); pg.wait_for_timeout(900)
    check('DUP: si confirma que es otra venta, sí la cobra', len(pg.evaluate('window.__DB.resto_cuentas'))==2)
e=run({'email':'u','role':'','db':dup_db()},DUP1,LS_ADM); print('ERR DUP1',e)

def DUP2(pg):
    msgs=[]; pg.on('dialog',lambda d:(msgs.append(d.message), d.accept()))
    cobra_mesa3(pg)
    pg.click('[data-act="mostrador"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="inc"][data-id="m1"]'); pg.wait_for_timeout(200)
    pg.click('[data-act="mospagar"]'); pg.wait_for_timeout(900)
    check('DUP2: una venta distinta por mostrador (1 café) no molesta con avisos', not any('ya se cobraron' in m for m in msgs) and len(pg.evaluate('window.__DB.resto_cuentas'))==2)
e=run({'email':'u','role':'','db':dup_db()},DUP2,LS_ADM); print('ERR DUP2',e)

def DUP3(pg):
    msgs=[]; pg.on('dialog',lambda d:(msgs.append(d.message), d.accept()))
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    pg.click('[data-act="cerrar"]'); pg.wait_for_timeout(200)
    # otro equipo cobra la misma mesa justo antes de que esta pantalla confirme
    pg.evaluate("window.__DB.resto_comandas.forEach(c=>c.cerrada=true); window.__DB.resto_cuentas.push({id:'otro',local_id:'L1',mesa:3,total:5000,propina:0,metodo:'Efectivo',garzon:'Ana',items:[{n:'Café',q:2,p:2500}],turno_id:'T1',created_at:new Date().toISOString()})")
    pg.click('[data-act="pagar"]'); pg.wait_for_timeout(900)
    check('DUP3: si otro equipo ya cobró la mesa, avisa', any('ya fue cobrada' in m for m in msgs))
    check('DUP3: no crea un segundo cobro de la misma mesa', len([c for c in pg.evaluate('window.__DB.resto_cuentas') if c['mesa']==3])==1)
    check('DUP3: no muestra "Cobrado" ni queda la mesa abierta en pantalla', 'Cobrado' not in pg.inner_text('body') and pg.locator('[data-act="pagar"]').count()==0)
e=run({'email':'u','role':'','db':dup_db()},DUP3,LS_ADM); print('ERR DUP3',e)

# ---- Pedir cuenta / "garzón cobra" por local ----
def pc_db(cobra, caja=False, pedida=False):
    d=db_roles(caja=caja); d['resto_locales'][0]['garzon_cobra']=cobra
    d['resto_comandas']=[{'id':'c1','local_id':'L1','mesa':3,'items':[{'n':'Café','q':2,'p':2500,'e':'cafeteria'}],'nota':'','estado':'entregado','garzon':'Ana','created_at':iso(20),'cerrada':False,'cuenta_pedida_at':(iso(1) if pedida else None)}]
    return d
def PC1(pg):
    pg.on('dialog',lambda d:d.accept())
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    check('PC1: con "solo cobra la caja" el garzón sin PIN de caja no ve Cerrar cuenta', pg.locator('[data-act="cerrar"]').count()==0 and pg.locator('[data-act="parcial"]').count()==0)
    check('PC1: ve el botón Pedir cuenta a la caja', pg.locator('[data-act="pedircuenta"]').count()==1)
    n0=len(pg.evaluate('window.__DB.resto_cuentas'))
    pg.click('[data-act="pedircuenta"]'); pg.wait_for_timeout(700)
    check('PC1: la mesa queda marcada con cuenta pedida', bool(pg.evaluate('window.__DB.resto_comandas[0].cuenta_pedida_at')))
    check('PC1: pedir la cuenta no crea ningún cobro', len(pg.evaluate('window.__DB.resto_cuentas'))==n0)
    check('PC1: el botón pasa a "Cuenta pedida" y queda desactivado', 'Cuenta pedida' in pg.inner_text('#app') and pg.locator('[data-act="pedircuenta"][disabled]').count()==1)
e=run({'email':'u','role':'','db':pc_db(False)},PC1,LS_ANA); print('ERR PC1',e)

def PC2(pg):
    pg.on('dialog',lambda d:d.accept())
    check('PC2: la administradora ve la mesa con "Cuenta pedida" en el plano', 'Cuenta pedida' in pg.inner_text('[data-act="mesa"][data-n="3"]'))
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    check('PC2: la administradora puede cobrarla (Cerrar cuenta) y ve el aviso', pg.locator('[data-act="cerrar"]').count()==1 and 'pidió la cuenta' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':pc_db(False,pedida=True)},PC2,LS_ADM); print('ERR PC2',e)

def PC3(pg):
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    check('PC3: aunque el local tenga datos viejos con "garzones cobran", el garzón sin PIN de caja no cobra y pide la cuenta', pg.locator('[data-act="cerrar"]').count()==0 and pg.locator('[data-act="parcial"]').count()==0 and pg.locator('[data-act="pedircuenta"]').count()==1)
e=run({'email':'u','role':'','db':pc_db(True)},PC3,LS_ANA); print('ERR PC3',e)

def PC4(pg):
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    check('PC4: el garzón con PIN de caja sí cobra aunque el local pida cuenta a la caja', pg.locator('[data-act="cerrar"]').count()==1 and pg.locator('[data-act="pedircuenta"]').count()==0)
e=run({'email':'u','role':'','db':pc_db(False,caja=True)},PC4,LS_ANA); print('ERR PC4',e)

def PC5(pg):
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('PC5: la administradora ya no ve interruptor y se le explica que solo cobra la caja', pg.locator('[data-act="garzcobra"]').count()==0 and 'Solo cobra la caja' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':pc_db(True)},PC5,LS_ADM); print('ERR PC5',e)

# ---- El garzón solo indica la propina; la caja cobra y ve el aviso ----
def PT1(pg):
    pg.on('dialog',lambda d:d.accept())
    pg.click('[data-act="mesa"][data-n="3"]'); pg.wait_for_timeout(300)
    check('PT1: el garzón ve el formulario de propina (sin botones de cobro)', pg.locator('#gp-inc').count()==1 and pg.locator('[data-act="cerrar"]').count()==0 and pg.locator('[data-act="pagar"]').count()==0)
    pg.select_option('#gp-pct','15'); pg.wait_for_timeout(150)
    pg.fill('#gp-tj','500'); pg.fill('#gp-efe','300'); pg.select_option('#gp-donde','mano'); pg.wait_for_timeout(150)
    n0=len(pg.evaluate('window.__DB.resto_cuentas'))
    pg.click('[data-act="pedircuenta"]'); pg.wait_for_timeout(800)
    c=pg.evaluate('window.__DB.resto_comandas[0]')
    check('PT1: la cuenta queda pedida con la propina indicada', bool(c.get('cuenta_pedida_at')) and c.get('propina_pedida')=={'inc':True,'pct':15,'tj':500,'efe':300,'donde':'mano','por':'Ana'})
    check('PT1: el garzón no registra ningún cobro', len(pg.evaluate('window.__DB.resto_cuentas'))==n0)
    pg.fill('#gp-efe','800'); pg.click('[data-act="gpsave"]'); pg.wait_for_timeout(700)
    check('PT1: puede actualizar la propina mientras la caja no cobra', pg.evaluate('window.__DB.resto_comandas[0].propina_pedida.efe')==800)
e=run({'email':'u','role':'','db':pc_db(False)},PT1,LS_ANA); print('ERR PT1',e)

def pt_db():
    d=pc_db(False,pedida=True); n=iso(5)
    d['resto_comandas'][0]['propina_pedida']={'inc':True,'pct':15,'tj':500,'efe':300,'donde':'mano','por':'Ana'}
    d['resto_turnos']=[{'id':'T1','local_id':'L1','abierto_por':'Administradora','monto_inicial':100000,'abierto_at':n,'created_at':n}]
    return d
def PT2(pg):
    pg.on('dialog',lambda d:d.accept())
    t=pg.inner_text('#app')
    check('PT2: la caja ve el aviso con la mesa, el garzón y la propina indicada', 'Cuentas por cobrar en caja' in t and 'Mesa 3' in t and 'Ana' in t and 'Propina 15%' in t)
    pg.click('.card [data-act="cobrarmesa"][data-n="3"]'); pg.wait_for_timeout(500)
    check('PT2: al cobrar se precarga la propina que indicó el garzón', pg.input_value('#proppct')=='15' and pg.input_value('#pefec')=='300' and pg.input_value('#pedonde')=='mano' and 'indicó' in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':pt_db()},PT2,LS_ADM); print('ERR PT2',e)

def PT3(pg):
    check('PT3: el garzón sin PIN de caja no ve el aviso de cuentas por cobrar', 'Cuentas por cobrar en caja' not in pg.inner_text('#app'))
e=run({'email':'u','role':'','db':pt_db()},PT3,LS_ANA); print('ERR PT3',e)


# --- QR: pedidos por confirmar y avisos de mesa (migración 032)
def qr_db(roles=False):
    d=db_roles() if roles else base_db()
    d['resto_locales'][0].update({'qr_activo':True,'qr_confirmar':True})
    d['resto_qr_pedidos']=[{'id':'qp1','local_id':'L1','mesa':4,'items':[{'id':'m2','n':'Torta','q':2,'p':3000,'e':'cocina'},{'id':'m1','n':'Café','q':1,'p':2500,'e':'cafeteria'}],'nota':'📱 Pedido QR · Ana · sin sal','estado':'por_confirmar','created_at':iso(2)}]
    d['resto_qr_avisos']=[{'id':'qa1','local_id':'L1','mesa':5,'tipo':'garzon','atendido':False,'created_at':iso(1)},{'id':'qa2','local_id':'L1','mesa':3,'tipo':'cuenta','atendido':False,'created_at':iso(1)}]
    return d
def QR1(pg):
    t=pg.inner_text('#app')
    check('QR1: la administradora ve el pedido QR por confirmar con mesa, productos, nota y total', 'Pedidos QR por confirmar (1)' in t and 'Mesa 4' in t and '2× Torta' in t and 'sin sal' in t and '$8.500' in t)
    check('QR1: ve los avisos de las mesas (llamado y cuenta)', 'Mesa 5' in t and 'llama al garzón' in t and 'pidió la cuenta' in t)
    check('QR1: las mesas con aviso muestran el icono en el plano', '🔔' in pg.inner_text('button.mesa[data-n="5"]') and '🧾' in pg.inner_text('button.mesa[data-n="3"]'))
    pg.click('[data-act="qrok"]'); pg.wait_for_timeout(700)
    check('QR1: confirmar llama a la base con el id del pedido', pg.evaluate("window.__RPC.some(c=>c[0]==='resto_qr_confirmar'&&c[1].p_pedido==='qp1')"))
    check('QR1: el pedido sale del panel y llega a cocina como comanda', 'Pedidos QR por confirmar' not in pg.inner_text('#app') and any(c.get('qr_pedido_id')=='qp1' for c in pg.evaluate('window.__DB.resto_comandas')))
    pg.click('[data-act="qratender"][data-id="qa1"]'); pg.wait_for_timeout(700)
    check('QR1: "Atendido" saca el aviso del panel', pg.evaluate("window.__DB.resto_qr_avisos[0].atendido")==True and 'Mesa 5' not in pg.inner_text('.card[style*="var(--brand)"]') if pg.locator('.card[style*="var(--brand)"]').count() else True)
e=run({'email':'u','role':'','db':qr_db()},QR1,LS_ADM); print('ERR QR1',e)

def QR2(pg):
    pg.click('[data-act="qrno"]'); pg.wait_for_timeout(300)
    check('QR2: rechazar pide un motivo opcional', pg.locator('#qrr-m').count()==1)
    pg.fill('#qrr-m','Se acabó la torta'); pg.click('[data-act="qrnook"]'); pg.wait_for_timeout(700)
    check('QR2: rechaza con el motivo y el pedido sale del panel', pg.evaluate("window.__DB.resto_qr_pedidos[0].estado")=='rechazado' and pg.evaluate("window.__DB.resto_qr_pedidos[0].motivo")=='Se acabó la torta' and 'Pedidos QR por confirmar' not in pg.inner_text('#app'))
    check('QR2: un pedido rechazado no genera comanda', not any(c.get('qr_pedido_id') for c in pg.evaluate('window.__DB.resto_comandas')))
e=run({'email':'u','role':'','db':qr_db()},QR2,LS_ADM); print('ERR QR2',e)

def QR3(pg):
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('QR3: la administradora ve el interruptor de confirmar pedidos QR', pg.locator('[data-act="qrconf"]').count()==1 and 'Dejar de confirmar' in pg.inner_text('[data-act="qrconf"]'))
    pg.click('[data-act="qrconf"]'); pg.wait_for_timeout(700)
    check('QR3: lo apaga en el local (los pedidos vuelven a ir directo a cocina)', pg.evaluate('window.__DB.resto_locales[0].qr_confirmar')==False)
    pg.click('[data-act="qrconf"]'); pg.wait_for_timeout(700)
    check('QR3: lo vuelve a encender', pg.evaluate('window.__DB.resto_locales[0].qr_confirmar')==True)
e=run({'email':'u','role':'','db':qr_db()},QR3,LS_ADM); print('ERR QR3',e)

def QR4(pg):
    t=pg.inner_text('#app')
    check('QR4: sin la migración 032 no aparece el panel ni se rompe nada', 'Pedidos QR por confirmar' not in t and 'Avisos de las mesas' not in t and pg.locator('[data-act="mesa"]').count()>0)
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('QR4: en ajustes avisa que falta ejecutar la migración 032 y no ofrece confirmar', 'migración 032' in pg.inner_text('#app') and pg.locator('[data-act="qrconf"]').count()==0)
e=run({'email':'u','role':'','db':qr_db(),'missing':['resto_qr_pedidos','resto_qr_avisos']},QR4,LS_ADM); print('ERR QR4',e)

def QR5(pg):
    t=pg.inner_text('#app')
    check('QR5: el garzón ve los pedidos por confirmar', 'Pedidos QR por confirmar (1)' in t)
    check('QR5: el garzón ve el aviso de su mesa 3 pero no el de la mesa 5 de otro garzón', 'pidió la cuenta' in t and 'llama al garzón' not in t)
e_db=qr_db(True); e_db['resto_comandas']=[{'id':'c3','local_id':'L1','mesa':3,'items':[{'n':'Café','q':1,'p':2500,'e':'cafeteria'}],'nota':'','estado':'entregado','garzon':'Ana','created_at':iso(20),'cerrada':False},{'id':'c5','local_id':'L1','mesa':5,'items':[{'n':'Café','q':1,'p':2500,'e':'cafeteria'}],'nota':'','estado':'entregado','garzon':'Beto','created_at':iso(20),'cerrada':False}]
e=run({'email':'u','role':'','db':e_db},QR5,LS_ANA); print('ERR QR5',e)

# --- Pedido del cliente (pedir.html) con la base simulada
PEDIR_STUB = """
window.__CALLS=[]; window.__EST='por_confirmar'; window.__FASE=1; window.__MOT='';
window.supabase={createClient:()=>({rpc:async(n,p)=>{ window.__CALLS.push([n,p]);
  if(n==='resto_qr_menu') return {data:Object.assign({nombre:'Super Pastel',mesas:8,mesas2:6,menu:(window.__MENU||[{id:'m1',n:'Café',c:'Bebidas',p:2500,e:'cafeteria'},{id:'m2',n:'Torta',c:'Pasteles',p:3000,e:'cocina'}])}, window.__VIEJA?{}:{confirmar:true}),error:null};
  if(n==='resto_qr_pedir') return {data:window.__VIEJA?{ok:true}:{ok:true,pedido:'P1',estado:'por_confirmar'},error:null};
  if(n==='resto_qr_estado') return {data:{estado:window.__EST,fase:window.__FASE,motivo:window.__MOT},error:null};
  if(n==='resto_qr_avisar') return {data:{ok:true},error:null};
  return {data:null,error:{message:'rpc desconocida'}}; }})};
"""
def run_pedir(fn, pre=''):
    with sync_playwright() as p:
        b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':800}); pg=ctx.new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.add_init_script(pre+PEDIR_STUB)
        pg.route('**/@supabase/supabase-js@2',lambda r:r.fulfill(body='/*stub*/',content_type='application/javascript'))
        pg.goto('http://127.0.0.1:'+str(PORT)+'/pedir.html?l=L1&m=4'); pg.wait_for_timeout(600)
        fn(pg); b.close(); return errs
def enviar_torta(pg):
    pg.click('[data-a="mas"][data-id="m2"]'); pg.click('[data-a="ver"]'); pg.wait_for_timeout(200); pg.click('[data-a="enviar"]'); pg.wait_for_timeout(500)

def CL1(pg):
    t=pg.inner_text('#app')
    check('CL1: la carta muestra Llamar al garzón y Pedir la cuenta y avisa que la caja confirma', 'Llamar al garzón' in t and 'Pedir la cuenta' in t and 'la caja confirmará' in t)
    enviar_torta(pg)
    check('CL1: tras enviar queda en "Pedido recibido" esperando a la caja', 'La caja lo está confirmando' in pg.inner_text('#app') and 'Pedido recibido' in pg.inner_text('.seg li.ahora'))
    check('CL1: el pedido se manda a la base con la mesa y la cantidad', pg.evaluate("window.__CALLS.some(c=>c[0]==='resto_qr_pedir'&&c[1].p_mesa===4&&c[1].p_items[0].id==='m2'&&c[1].p_items[0].q===1)"))
    pg.evaluate("window.__EST='confirmado'; window.__FASE=2"); pg.wait_for_timeout(4600)
    check('CL1: al confirmarse pasa a "Pedido confirmado" (cocina lo prepara)', 'Pedido confirmado' in pg.inner_text('.seg li.ahora') and 'Cocina ya lo está preparando' in pg.inner_text('#app'))
    pg.evaluate("window.__FASE=3"); pg.wait_for_timeout(4600)
    check('CL1: cuando cocina lo marca listo pasa a "En camino a tu mesa"', 'En camino' in pg.inner_text('.seg li.ahora'))
    pg.evaluate("window.__FASE=4"); pg.wait_for_timeout(4600)
    check('CL1: al entregarse muestra "¡Tu pedido llegó!" con los 4 pasos hechos', '¡Tu pedido llegó!' in pg.inner_text('#app') and pg.locator('.seg li.hecho').count()==4)
    pg.click('[data-a="llamar"]'); pg.wait_for_timeout(300)
    check('CL1: Llamar al garzón avisa a la base y queda como "Ya avisamos"', pg.evaluate("window.__CALLS.some(c=>c[0]==='resto_qr_avisar'&&c[1].p_tipo==='garzon'&&c[1].p_mesa===4)") and 'Ya avisamos al garzón' in pg.inner_text('.acc'))
    pg.click('[data-a="cuenta"]'); pg.wait_for_timeout(200)
    check('CL1: Pedir la cuenta pide tocar dos veces y no avisa con el primer toque', 'Toca otra vez' in pg.inner_text('.acc') and not pg.evaluate("window.__CALLS.some(c=>c[0]==='resto_qr_avisar'&&c[1].p_tipo==='cuenta')"))
    pg.click('[data-a="cuenta"]'); pg.wait_for_timeout(300)
    check('CL1: con el segundo toque pide la cuenta', pg.evaluate("window.__CALLS.some(c=>c[0]==='resto_qr_avisar'&&c[1].p_tipo==='cuenta')") and 'Cuenta pedida' in pg.inner_text('.acc'))
e=run_pedir(CL1); print('ERR CL1',e)

def CL2(pg):
    enviar_torta(pg)
    pg.reload(); pg.wait_for_timeout(900)
    check('CL2: si el cliente recarga la página retoma el seguimiento de su pedido', pg.locator('.seg').count()==1 and 'Pedido recibido' in pg.inner_text('.seg li.ahora'))
e=run_pedir(CL2); print('ERR CL2',e)

def CL3(pg):
    pg.evaluate("window.__EST='rechazado'; window.__MOT='Se acabó la torta'")
    enviar_torta(pg); pg.wait_for_timeout(4600)
    t=pg.inner_text('#app')
    check('CL3: si la caja rechaza, el cliente ve el motivo y puede volver a pedir', 'No pudimos tomar tu pedido' in t and 'Se acabó la torta' in t and pg.locator('[data-a="otro"]').count()==1)
e=run_pedir(CL3); print('ERR CL3',e)

def CL4(pg):
    check('CL4: con una base sin la migración 032 no se muestran los botones nuevos', 'Llamar al garzón' not in pg.inner_text('#app'))
    enviar_torta(pg)
    check('CL4: y el pedido sigue funcionando con la pantalla simple de antes', '¡Pedido enviado!' in pg.inner_text('#app'))
e=run_pedir(CL4,'window.__VIEJA=true;'); print('ERR CL4',e)


# --- Fotos de la carta y buscador del cliente
import base64
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
def FT1(pg):
    pg.evaluate("S.rol='ingeniero'; S.quien='Carlos Oporto'; render()"); pg.wait_for_timeout(300)
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('FT1: cada plato tiene su botón de foto', pg.locator('input[data-foto="m1"]').count()==1)
    pg.set_input_files('input[data-foto="m1"]',files=[{'name':'cafe.png','mimeType':'image/png','buffer':PNG}]); pg.wait_for_timeout(1200)
    up=pg.evaluate('window.__UP||[]')
    check('FT1: sube la foto achicada (JPG) a la carpeta del local', len(up)==1 and up[0]['b']=='resto-fotos' and up[0]['path'].startswith('L1/m1-') and up[0]['type']=='image/jpeg')
    check('FT1: guarda la dirección de la foto en el plato', str(pg.evaluate("window.__DB.resto_menu.find(m=>m.id==='m1').foto")).startswith('https://fotos.test/resto-fotos/L1/m1-'))
    check('FT1: la carta muestra la miniatura y "Cambiar foto"', pg.locator('img[src^="https://fotos.test/"]').count()>=1 and 'Cambiar foto' in pg.inner_text('#app'))
    pg.on('dialog',lambda d:d.accept())
    pg.click('[data-act="fotoquitar"][data-id="m1"]'); pg.wait_for_timeout(800)
    check('FT1: "Quitar foto" la borra del plato y del almacenamiento', not pg.evaluate("window.__DB.resto_menu.find(m=>m.id==='m1').foto") and len(pg.evaluate('window.__RM||[]'))>=1)
LS_ING="localStorage.setItem('pr-rol', JSON.stringify({lid:'L1',rol:'ingeniero',quien:'Carlos Oporto',tok:'T',t:Date.now()}));"
e=run({'email':'u','role':'','db':db_roles()},FT1,LS_ADM); print('ERR FT1',e)

def FT2(pg):
    pg.click('[data-act="tab"][data-v="carta"]'); pg.wait_for_timeout(300)
    check('FT2: la administradora VE la foto del plato en su carta', pg.locator('img[src^="https://fotos.test/"]').count()==1)
    check('FT2: pero no tiene botón para subir, cambiar ni quitar fotos', pg.locator('input[data-foto]').count()==0 and pg.locator('[data-act="fotoquitar"]').count()==0 and 'Cambiar foto' not in pg.inner_text('#app'))
d_ft2=db_roles(); d_ft2['resto_menu'][0]['foto']='https://fotos.test/resto-fotos/L1/m1-1.jpg'
e=run({'email':'u','role':'','db':d_ft2},FT2,LS_ADM); print('ERR FT2',e)

MENU_GRANDE = "Array.from({length:30},(_,k)=>({id:'p'+k,n:(k%3==0?'Café ':k%3==1?'Torta ':'Sándwich ')+k,c:(k%3==0?'Bebidas':k%3==1?'Pasteles':'Salados'),p:1000+k,f:(k==1?'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==':''),e:'cocina'}))"
def run_pedir_menu(fn):
    return run_pedir(fn, "window.__MENU="+MENU_GRANDE+";")
def CL5(pg):
    check('CL5: con carta larga aparece la lupa y las categorías', pg.locator('#bus').count()==1 and pg.locator('.chips button').count()==4)
    pg.fill('#bus','sandwich'); pg.wait_for_timeout(200)
    t=pg.inner_text('#lista')
    check('CL5: la lupa encuentra sin importar tildes ni mayúsculas', 'Sándwich 2' in t and 'Torta' not in t and 'Café' not in t)
    pg.fill('#bus','xyz'); pg.wait_for_timeout(200)
    check('CL5: sin resultados avisa amablemente', 'No encontramos nada' in pg.inner_text('#lista'))
    pg.fill('#bus',''); pg.click('.chips button:has-text("Pasteles")'); pg.wait_for_timeout(200)
    check('CL5: tocar una categoría muestra solo esa', 'Torta 1' in pg.inner_text('#lista') and 'Café' not in pg.inner_text('#lista'))
    pg.click('.chips button:has-text("Todo")'); pg.wait_for_timeout(200)
    check('CL5: la foto aparece solo en el producto que la tiene', pg.locator('img.ph').count()==1)
    pg.click('img.ph'); pg.wait_for_timeout(200)
    check('CL5: tocar la foto la amplía con nombre y precio', pg.locator('.zoom img').count()==1 and 'Torta 1' in pg.inner_text('.zoom') and '$1.001' in pg.inner_text('.zoom'))
    pg.click('.zoom button.btn'); pg.wait_for_timeout(200)
    check('CL5: desde la foto se puede agregar al pedido y se cierra', pg.locator('.zoom').count()==0 and 'Ver mi pedido (1)' in pg.inner_text('.bar'))
e=run_pedir_menu(CL5); print('ERR CL5',e)

bad=[n for n,ok in results if not ok]; print('\nRESULT', len(results)-len(bad),'/',len(results),'OK', 'FALLAS:',bad)
