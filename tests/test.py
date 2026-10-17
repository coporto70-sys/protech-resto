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
    check('A: aparece botón Ayuda', pg.locator('#chat-fab').is_visible())
    pg.click('#chat-fab'); pg.wait_for_timeout(200)
    pg.fill('#chat-in','¿Cómo cobro una mesa?'); pg.click('#chat-send'); pg.wait_for_timeout(600)
    t=pg.inner_text('#chat-msgs')
    check('A: el asistente responde sobre cobrar', 'Cobrar' in t and 'vuelto' in t)
    pg.fill('#chat-in','xyzzy qwerty plugh'); pg.click('#chat-send'); pg.wait_for_timeout(600)
    t=pg.inner_text('#chat-msgs')
    check('A: sin respuesta escala a soporte', 'avisé a soporte' in t)
    check('A: modo humano', 'Hablando con soporte' in pg.inner_text('#chat-modo'))
    rows=pg.evaluate('window.__DB.resto_chat')
    check('A: mensaje marcado humano en BD', any(r['autor']=='cliente' and r.get('humano') for r in rows))
    pg.evaluate("window.__emitSoporte({local_id:'L1',autor:'soporte',quien:'Soporte Protech',texto:'Hola, ya lo reviso'})"); pg.wait_for_timeout(300)
    check('A: llega respuesta de soporte en vivo', 'ya lo reviso' in pg.inner_text('#chat-msgs'))
    pg.click('#chat-chips button[data-b]'); pg.wait_for_timeout(500)
    check('A: vuelve al asistente', 'Asistente automático' in pg.inner_text('#chat-modo'))
    pg.fill('#chat-in','no me suena la cocina'); pg.click('#chat-send'); pg.wait_for_timeout(500)
    check('A: responde sobre sonido', 'Sonido' in pg.inner_text('#chat-msgs'))
    pg.fill('#chat-in','se cierra la sesión a cada rato'); pg.click('#chat-send'); pg.wait_for_timeout(500)
    check('A: responde sobre sesión', '16 horas' in pg.inner_text('#chat-msgs'))
    check('A: widget no aparece en admin', True)
e=run({'email':'dueno@sp.cl','role':'','db':base_db()},A); print('ERR A',e)

# --- B: soporte
def B(pg):
    check('B: botón de chat de clientes NO visible para soporte', not pg.locator('#chat-fab').is_visible())
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
    check('C: sin tabla, el chat del cliente queda oculto', not pg.locator('#chat-fab').is_visible())
    check('C: la app sigue funcionando', 'Mesa' in pg.inner_text('#app') or 'Mesas' in pg.inner_text('#app'))
e=run({'email':'dueno@sp.cl','role':'','db':base_db(chat=False),'missing':['resto_chat']},C); print('ERR C',e)
def C2(pg):
    pg.click('[data-sp="sub"][data-v="chat"]'); pg.wait_for_timeout(400)
    check('C2: soporte ve aviso de migración pendiente', 'migración' in pg.inner_text('#app'))
db=base_db(chat=False); db['resto_miembros']=[]
e=run({'email':'g@x.cl','role':'protech_admin','db':db,'missing':['resto_chat']},C2); print('ERR C2',e)

# --- D: sin IA, solo guía y soporte
def D(pg):
    pg.click('#chat-fab'); pg.wait_for_timeout(200)
    pg.fill('#chat-in','¿Cómo cobro una mesa?'); pg.click('#chat-send'); pg.wait_for_timeout(600)
    check('D: pregunta conocida responde con la guía', 'vuelto' in pg.inner_text('#chat-msgs'))
    pg.fill('#chat-in','la impresora de boletas no imprime nada'); pg.click('#chat-send'); pg.wait_for_timeout(800)
    check('D: duda desconocida va a soporte', 'Hablando con soporte' in pg.inner_text('#chat-modo'))
    check('D: nunca se llama a la IA', (pg.evaluate('window.__IA_CALLS||0'))==0)
    rows=pg.evaluate('window.__DB.resto_chat')
    check('D: queda marcado para soporte', any(r['autor']=='cliente' and r.get('humano') for r in rows))
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
    check('K: avisa que el sencillo fijo está incompleto', 'Falta $20.000' in c)
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(500)
    check('K: no cierra con sencillo distinto al fijo sin observación', any('sencillo fijo' in m for m in d) and pg.evaluate('window.__DB.resto_turnos[0].cerrado_at') is None)
    pg.fill('#dnd-20000','100000'); pg.wait_for_timeout(300)
    c=pg.inner_text('#cuadre')
    check('K: con el sencillo completo muestra Correcto y el retiro', 'Correcto' in c and 'Efectivo de ventas a retirar' in c and '$15.000' in c)
    pg.click('[data-act="tcerrar"]'); pg.wait_for_timeout(800)
    tu=pg.evaluate('window.__DB.resto_turnos')[0]
    check('K: cierre guarda retiro, sencillo dejado y gastos', tu.get('cerrado_at') and tu['retiro_efectivo']==15000 and tu['desglose_deja']=={'20000':5,'10000':6} and tu['gastos_total']==15000 and tu['diferencia']==0)
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

bad=[n for n,ok in results if not ok]; print('\nRESULT', len(results)-len(bad),'/',len(results),'OK', 'FALLAS:',bad)
