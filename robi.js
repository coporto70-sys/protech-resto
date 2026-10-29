/* Protech Resto · Robi, el robot guía de caja
   Acompaña a quien abre y cierra la caja: dice qué hacer ahora y avisa, con cariño, si algo no cuadra.
   Los textos y las cifras salen SOLO de reglas fijas (nunca de una IA), igual que los avisos de control de caja.
   Es solo una guía: no guarda, no corrige ni mueve dinero. La voz usa la voz del propio dispositivo (speechSynthesis). */
(function (root) {
  const $ = n => '$' + Math.round(n).toLocaleString('es-CL');
  const dif = (d, que) => (d > 0 ? 'sobran ' : 'faltan ') + $(Math.abs(d)) + (que ? ' ' + que : '');

  /* Entrada (todo ya calculado por la app):
     { quien, esperado: {m, de: 'turno'|'partida'} (sencillo que se debe recibir: lo que dejó el turno anterior), turno: null | {monto_inicial, abierto_h}, apertura: {total, escribio},
       res: {cuentas, vt, esp, tj, tr, pp}, cierre: {escribio, ef, tj, tr, dj, hayD} }
     Salida: { tono: 'ok'|'aviso'|'mal'|'hola', txt, paso } */

  /* Consejo de cada pestaña: qué se puede hacer ahí. Robi lo muestra cuando no hay nada más urgente que decir. */
  const CONSEJOS = {
    mesas: ['Mesas', 'Aquí se toman los pedidos. Toca una mesa libre, agrega los productos y envía a cocina. Para cobrar, abre la mesa y toca Cobrar. Arriba tienes Para llevar y Delivery.'],
    cocina: ['Cocina', 'Aquí llegan las comandas. Cuando un pedido esté listo, márcalo para que el garzón lo vea y lo lleve a la mesa.'],
    cafe: ['Cafetería', 'Aquí llegan las comandas de cafés y bebidas calientes. Marca cada una como lista cuando salga.'],
    carta: ['Carta y mesas', 'Aquí se edita la carta: nombre, sección, precio y si se prepara en cocina o cafetería. También se define cuántas mesas hay.'],
    garz: ['Garzones', 'Aquí se agregan los garzones y se les da su PIN. Solo la administradora ve esta pestaña.'],
    turno: ['Caja', 'Aquí se abre y se cierra la caja. Al abrir, cuenta el sencillo que dejó el turno anterior; al cerrar, cuenta el efectivo, las tarjetas y las transferencias.'],
    caja: ['Ventas', 'Aquí ves lo vendido en el día y puedes descargar los reportes. Solo la administradora ve esta pestaña.'],
    resumen: ['Resumen', 'Aquí ves cómo va el día de un vistazo: ventas, productos más pedidos y propinas.'],
    coms: ['Comandas', 'Aquí se revisan todas las comandas enviadas, por si hubo un error en un pedido.'],
    inv: ['Inventario', 'Aquí ves el stock de cada producto, ingresas mercadería y ves lo que está por agotarse. El triángulo ⚠ avisa si algo está bajo el mínimo.'],
    tortas: ['Ventas de tortas', 'Aquí anotas los encargos de tortas con el nombre y teléfono del cliente, la fecha y hora de entrega y el precio. Los abonos quedan en la caja del turno en que los recibes. Al retirar la torta, toca «Retirar y cobrar saldo». El calendario muestra los días con entregas.'],
    resv: ['Reservas', 'Aquí anotas las reservas con fecha, hora, nombre, personas y mesa. La mesa aparece como reservada en el plano.'],
    bit: ['Registro de cambios', 'Aquí queda anotado quién cambió qué y cuándo: precios, montos de caja, anulaciones. Nada se borra.'],
    prod: ['Inventario de producción', 'Aquí va lo que se compra para producir (mermeladas, tarros de duraznos, cremas…), aparte de la carta.'],
    abast: ['Compras y recetas', 'Aquí defines las recetas de cada producto y haces las órdenes de compra a tus proveedores.'],
  };
  function consejo(vista, quien) {
    const c = CONSEJOS[vista];
    const hola = quien ? '¡Hola, ' + quien + '! ' : '¡Hola! ';
    const fiesta = mago() ? '¡Feliz noche de magia! ' : halloween() ? '¡Feliz Halloween! ' : '';
    if (!c) return { tono: 'hola', paso: 'Ayuda', txt: fiesta + hola + 'Soy Robi. Pregúntame lo que necesites del sistema.' };
    return { tono: 'hola', paso: c[0], txt: fiesta + hola + c[1] + ' Si tienes una duda, pregúntame abajo.' };
  }

  function mensaje(c) {
    if (c.vista && c.vista !== 'turno') return consejo(c.vista, c.quien);
    const nom = c.quien ? ', ' + c.quien : '';
    const esp = c.esperado || { m: 0, de: 'partida' }, fondo = esp.m || 0;
    const origen = esp.de === 'turno' ? 'lo que dejó el turno anterior' : 'el sencillo de partida';

    // ---- Caja cerrada: guía de apertura ----
    if (!c.turno) {
      const a = c.apertura || {};
      if (!a.escribio) {
        return { tono: 'hola', paso: 'Apertura · paso 1 de 2',
          txt: '¡Hola' + nom + '! Vamos a abrir la caja. Cuenta el sencillo billete por billete y escríbelo abajo.' + (fondo ? ' Debes recibir ' + $(fondo) + ' (' + origen + ').' : '') };
      }
      if (fondo && a.total !== fondo) {
        return { tono: 'aviso', paso: 'Apertura · paso 1 de 2',
          txt: 'Ojo: ' + dif(a.total - fondo, 'respecto de ' + origen + ' (' + $(fondo) + ')') + '. Vuelve a contar con calma antes de abrir. Si el sencillo realmente cambió, avísale a la administradora.' };
      }
      return { tono: 'ok', paso: 'Apertura · paso 2 de 2',
        txt: '¡Perfecto! ' + (fondo ? 'El sencillo coincide con ' + origen + ' (' + $(fondo) + '). ' : 'Abres con ' + $(a.total) + '. ') + 'Ahora toca el botón verde "Abrir caja".' };
    }

    // ---- Caja abierta ----
    const t = c.turno, r = c.res || {}, k = c.cierre || {};
    const avisos = [];
    if (fondo && !(t.monto_inicial > 0)) avisos.push('Esta caja se abrió sin registrar sencillo, y se esperaba recibir ' + $(fondo) + '. Por eso el cierre puede mostrar una diferencia que no es real. Avísale a la administradora.');
    if (t.abierto_h > 16) avisos.push('Este turno lleva ' + Math.round(t.abierto_h) + ' horas abierto. Conviene cerrar la caja al terminar cada día.');

    if (!k.escribio && k.tj == null && k.tr == null) {
      const base = 'Turno de la ' + (t.nombre || 'jornada') + ' abierto. Van ' + (r.cuentas || 0) + (r.cuentas === 1 ? ' cuenta' : ' cuentas') + ' y ' + $(r.vt || 0) + ' vendidos. Cuando termines el turno, te guío para cerrar.';
      const pp = r.pp ? ' Antes de contar, paga ' + $(r.pp) + ' de propinas a los garzones.' : '';
      return { tono: avisos.length ? 'aviso' : 'hola', paso: 'Caja abierta', txt: [base + pp].concat(avisos).join(' ') };
    }

    // Cierre en curso: revisa en este orden y dice lo primero que no cuadra
    const pasos = [];
    if (k.escribio && r.esp != null && k.ef !== r.esp) pasos.push({ tono: 'mal', txt: 'En efectivo ' + dif(k.ef - r.esp) + '. Recuenta los billetes y las monedas. Recuerda que el sistema ya descontó gastos, retiros y propinas pagadas.' });
    if (k.tj != null && k.tj !== r.tj) pasos.push({ tono: 'mal', txt: 'Las tarjetas no cuadran: ' + dif(k.tj - r.tj) + '. Mira el comprobante de la máquina y confirma que sea solo de este turno.' });
    if (k.tr != null && k.tr !== r.tr) pasos.push({ tono: 'mal', txt: 'Las transferencias no cuadran: ' + dif(k.tr - r.tr) + '. Revisa lo recibido en el banco durante el turno.' });
    if (k.escribio && !k.hayD) pasos.push({ tono: 'aviso', txt: 'Falta anotar el sencillo que dejas en la caja: es el que recibirá el turno siguiente.' });
    if (k.escribio && k.tj == null) pasos.push({ tono: 'aviso', txt: 'Falta anotar el total de tarjetas del terminal (escribe 0 si no hubo).' });
    if (k.escribio && k.tr == null) pasos.push({ tono: 'aviso', txt: 'Falta anotar las transferencias recibidas (escribe 0 si no hubo).' });
    if (!k.escribio) pasos.push({ tono: 'aviso', txt: 'Ahora cuenta el efectivo de la caja' + (r.esp != null ? '. Debe haber ' + $(r.esp) : '') + '.' });

    const mal = pasos.find(p => p.tono === 'mal');
    if (mal) return { tono: 'mal', paso: 'Cierre de caja', txt: mal.txt + ' Cuando termines, escribe una observación para explicar la diferencia.' };
    if (pasos.length) return { tono: 'aviso', paso: 'Cierre de caja', txt: pasos[0].txt };
    return { tono: 'ok', paso: 'Cierre de caja', txt: '¡Todo cuadra' + nom + '! Dejas ' + $(k.dj || 0) + ' de sencillo: ese monto debe recibir el próximo turno. Escribe una observación si quieres y toca "Cerrar caja". ¡Buen trabajo!' };
  }

  /* Disfraz de Halloween: del 24 de octubre al 2 de noviembre Robi usa sombrero de bruja. Se puede apagar en este equipo con localStorage 'pr-robi-hw' = '0'. */
  function ventanaFiesta() {
    try { if (root.localStorage && root.localStorage.getItem('pr-robi-hw') === '0') return false; } catch (e) {}
    const f = new Date(), m = f.getMonth(), d = f.getDate();
    return (m === 9 && d >= 24) || (m === 10 && d <= 2);
  }
  /* Tema "Academia Arcana": en las mismas fechas Robi es aprendiz de mago (sombrero de estrellas, capa y varita de diseño propio).
     Para volver a la bruja en este equipo: localStorage 'pr-robi-tema' = 'bruja'. */
  function mago() {
    try { if (root.localStorage && root.localStorage.getItem('pr-robi-tema') === 'bruja') return false; } catch (e) {}
    return ventanaFiesta();
  }
  function halloween() { return ventanaFiesta() && !mago(); }

  /* El robot: una esfera amigable que flota, con antena de corazón, ojos grandes, sonrisa y mejillas. Diseño propio de Protech. */
  function svg(tono, habla) {
    const boca = tono === 'mal' ? 'M41 66 Q50 60 59 66' : tono === 'aviso' ? 'M42 64 L58 64' : 'M40 62 Q50 72 60 62';
    const hw = halloween(), mg = mago();
    const estrellaMg = (x, y, k, c) => '<path transform="translate(' + x + ' ' + y + ') scale(' + k + ')" d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4Z" fill="' + c + '"/>';
    const gorro = '<g class="robi-mg">' +
      '<path d="M35 26 Q45 14 50 -5 Q56 14 65 26 Z" fill="#1e1b4b" stroke="#0f0d2e" stroke-width="2" stroke-linejoin="round"/>' +
      '<ellipse cx="50" cy="27" rx="31" ry="6" fill="#312e81" stroke="#0f0d2e" stroke-width="2"/>' +
      '<path d="M39 22.5 Q50 26 61 22.5 L62.5 26.5 Q50 30.5 37.5 26.5 Z" fill="#7f1d3a"/>' +
      '<circle cx="50" cy="26.4" r="2.2" fill="#e0b04a"/>' +
      estrellaMg(50, -7, 0.9, '#f6d98a') + estrellaMg(48, 9, 0.8, '#f6d98a') + estrellaMg(56, 17, 0.6, '#e0b04a') +
      '<path d="M44 16 A3.6 3.6 0 1 0 47 20.5 A2.7 2.7 0 1 1 44 16Z" fill="#f6d98a"/>' +
      '</g>';
    const capa = '<g class="robi-capa">' +
      '<path d="M24 86 Q50 100 76 86 L80 94 Q50 110 20 94 Z" fill="#7f1d3a" stroke="#4c0d22" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="50" cy="96.5" r="3.4" fill="#e0b04a" stroke="#a16207" stroke-width="1"/>' +
      '</g>';
    const varita = '<g class="robi-varita">' +
      '<path d="M91 60 L97 36" stroke="#5b3a1e" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M91 60 L92.4 55" stroke="#e0b04a" stroke-width="3" stroke-linecap="round"/>' +
      estrellaMg(97.5, 31, 1.1, '#fde047') +
      '<g class="robi-chispa">' + estrellaMg(88, 28, 0.55, '#f6d98a') + '</g>' +
      '<g class="robi-chispa">' + estrellaMg(97, 47, 0.5, '#c4b5fd') + '</g>' +
      '<g class="robi-chispa">' + estrellaMg(90, 40, 0.4, '#fde047') + '</g>' +
      '</g>';
    const sombrero = '<g class="robi-hw">' +
      '<path d="M35 25 Q44 13 49 5 Q55 -1 61 6 Q57 7 57 12 Q58 19 65 25 Z" fill="#6d28d9" stroke="#3b0764" stroke-width="2" stroke-linejoin="round"/>' +
      '<ellipse cx="50" cy="26" rx="30" ry="5.5" fill="#5b21b6" stroke="#3b0764" stroke-width="2"/>' +
      '<path d="M40 21.5 Q50 24 61 21.5 L62 25 Q50 28 39 25 Z" fill="#f97316"/>' +
      '<rect x="46.5" y="21.5" width="7" height="5.5" rx="1" fill="none" stroke="#fde047" stroke-width="1.8"/>' +
      '<path d="M84 12 Q87 8 90 12 Q93 8 96 12 Q93 11 90 15 Q87 11 84 12Z" fill="#1f1814"/>' +
      '</g>';
    const cejas = tono === 'mal' ? '<path d="M31 41 L43 46 M69 41 L57 46" stroke="#7c2d12" stroke-width="2.6" stroke-linecap="round"/>' : '';
    return '<svg class="robi-svg' + (habla ? ' habla' : '') + '" viewBox="' + (mg ? '0 -8 100 112' : '0 0 100 104') + '" aria-hidden="true" focusable="false">' +
      (hw || mg ? '' : '<line x1="50" y1="14" x2="50" y2="22" stroke="#78716c" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="robi-cor" d="M50 14 C44 5 34 9 38 16 C41 21 50 25 50 25 C50 25 59 21 62 16 C66 9 56 5 50 14Z" fill="#f43f5e"/>') +
      '<circle cx="9" cy="58" r="6" fill="#d9480f"/><circle cx="91" cy="58" r="6" fill="#d9480f"/>' +
      '<circle cx="50" cy="58" r="40" fill="#fff7ed" stroke="#d9480f" stroke-width="3.5"/>' +
      '<path d="M22 40 Q30 24 48 22" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/>' +
      '<g class="robi-ojos"><ellipse cx="37" cy="52" rx="6.5" ry="7.5" fill="#1f1814"/><ellipse cx="63" cy="52" rx="6.5" ry="7.5" fill="#1f1814"/>' +
      '<circle cx="39" cy="49.5" r="2.3" fill="#fff"/><circle cx="65" cy="49.5" r="2.3" fill="#fff"/></g>' + cejas +
      '<circle cx="27" cy="65" r="5" fill="#fda4af" opacity=".75"/><circle cx="73" cy="65" r="5" fill="#fda4af" opacity=".75"/>' +
      '<path class="robi-boca" d="' + boca + '" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/>' +
      (hw ? sombrero : '') + (mg ? capa + varita + gorro : '') +
      '</svg>';
  }

  /* Voz: usa la voz en español del dispositivo. Los iPhone solo dejan hablar después de tocar un botón. */
  const voz = {
    ok() { return !!(root.speechSynthesis && root.SpeechSynthesisUtterance); },
    hablando() { return !!(root.speechSynthesis && root.speechSynthesis.speaking); },
    decir(txt, fin) {
      if (!voz.ok()) return false;
      try {
        root.speechSynthesis.cancel();
        const u = new root.SpeechSynthesisUtterance(String(txt).replace(/\$(\d[\d.]*)/g, (m, n) => n.replace(/\./g, '') + ' pesos'));
        const vs = root.speechSynthesis.getVoices() || [];
        const v = vs.find(x => /^es-CL/i.test(x.lang)) || vs.find(x => /^es[-_]/i.test(x.lang)) || vs.find(x => /^es/i.test(x.lang));
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-CL';
        u.rate = 0.95; u.pitch = 1.15;
        u.onend = u.onerror = () => { if (fin) fin(); };
        root.speechSynthesis.speak(u);
        return true;
      } catch (e) { return false; }
    },
    callar() { try { root.speechSynthesis && root.speechSynthesis.cancel(); } catch (e) {} },
  };

  /* Cobros repetidos en vivo: mismo cobro (mesa, monto, forma de pago, garzón y productos) registrado dos veces con menos de 3 minutos de diferencia.
     Reglas fijas, sin IA. Recibe las cuentas ya cargadas por la app ({id, mesa, total, metodo, garzon, items, t}) y devuelve alertas con el formato del vigilante de caja. */
  const firma = its => (its || []).map(i => i.n + '×' + i.q).sort().join('|');
  /* Si se pasa `comandas` ({mesa, items, t}, últimas 12 h incluidas las cerradas), solo es repetido si lo cobrado de algún producto supera lo pedido en la mesa:
     dos cortados pedidos en comandas distintas y cobrados por separado NO son un cobro repetido. */
  const cant = (arr, mesa, n, ahora, ant) => (arr || []).filter(x => x.mesa === mesa && ahora - x.t < ant).reduce((s, x) => s + (x.items || []).filter(i => i.n === n).reduce((u, i) => u + (+i.q || 0), 0), 0);
  function duplicados(cuentas, ahora, ventanaMs, antiguedadMs, comandas) {
    const v = ventanaMs || 180000, ant = antiguedadMs || 12 * 3600000, out = [];
    const cu = (cuentas || []).filter(c => c && c.mesa > 0 && ahora - c.t < ant).sort((a, b) => a.t - b.t);
    for (let i = 0; i < cu.length; i++) {
      const b = cu[i];
      const a = cu.slice(0, i).reverse().find(x => x.mesa === b.mesa && x.total === b.total && x.metodo === b.metodo && (x.garzon || '') === (b.garzon || '') && firma(x.items) === firma(b.items) && b.t - x.t < v);
      if (!a) continue;
      if (comandas && !(b.items || []).some(i => cant(comandas, b.mesa, i.n, ahora, ant) < cant(cuentas.filter(x => x.id !== b.id && x.t <= b.t), b.mesa, i.n, ahora, ant) + (+i.q || 0))) continue;
      const seg = Math.round((b.t - a.t) / 1000);
      out.push({ id: 'dup-' + b.id, gravedad: 'alta', titulo: 'Posible cobro repetido: mesa ' + b.mesa,
        detalle: 'La mesa ' + b.mesa + (b.garzon ? ' (' + b.garzon + ')' : '') + ' se cobró dos veces con el mismo monto, ' + $(b.total) + ' en ' + String(b.metodo || '').toLowerCase() + ', con solo ' + seg + (seg === 1 ? ' segundo' : ' segundos') + ' de diferencia.',
        revisar: 'Pregunta si el cliente pagó una sola vez o dos. Si fue una sola, avisa a Protech para anular el cobro repetido antes de cerrar la caja.', fase: 'en vivo' });
    }
    return out;
  }

  const api = { mensaje, consejo, svg, voz, duplicados, mago };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Robi = api;
})(typeof window !== 'undefined' ? window : globalThis);
