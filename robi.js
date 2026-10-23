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
    if (!c) return { tono: 'hola', paso: 'Ayuda', txt: hola + 'Soy Robi. Pregúntame lo que necesites del sistema.' };
    return { tono: 'hola', paso: c[0], txt: hola + c[1] + ' Si tienes una duda, pregúntame abajo.' };
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

  /* El robot: una esfera amigable que flota, con antena de corazón, ojos grandes, sonrisa y mejillas. Diseño propio de Protech. */
  function svg(tono, habla) {
    const boca = tono === 'mal' ? 'M41 66 Q50 60 59 66' : tono === 'aviso' ? 'M42 64 L58 64' : 'M40 62 Q50 72 60 62';
    const cejas = tono === 'mal' ? '<path d="M31 41 L43 46 M69 41 L57 46" stroke="#7c2d12" stroke-width="2.6" stroke-linecap="round"/>' : '';
    return '<svg class="robi-svg' + (habla ? ' habla' : '') + '" viewBox="0 0 100 104" aria-hidden="true" focusable="false">' +
      '<line x1="50" y1="14" x2="50" y2="22" stroke="#78716c" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="robi-cor" d="M50 14 C44 5 34 9 38 16 C41 21 50 25 50 25 C50 25 59 21 62 16 C66 9 56 5 50 14Z" fill="#f43f5e"/>' +
      '<circle cx="9" cy="58" r="6" fill="#d9480f"/><circle cx="91" cy="58" r="6" fill="#d9480f"/>' +
      '<circle cx="50" cy="58" r="40" fill="#fff7ed" stroke="#d9480f" stroke-width="3.5"/>' +
      '<path d="M22 40 Q30 24 48 22" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/>' +
      '<g class="robi-ojos"><ellipse cx="37" cy="52" rx="6.5" ry="7.5" fill="#1f1814"/><ellipse cx="63" cy="52" rx="6.5" ry="7.5" fill="#1f1814"/>' +
      '<circle cx="39" cy="49.5" r="2.3" fill="#fff"/><circle cx="65" cy="49.5" r="2.3" fill="#fff"/></g>' + cejas +
      '<circle cx="27" cy="65" r="5" fill="#fda4af" opacity=".75"/><circle cx="73" cy="65" r="5" fill="#fda4af" opacity=".75"/>' +
      '<path class="robi-boca" d="' + boca + '" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/>' +
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

  const api = { mensaje, consejo, svg, voz };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Robi = api;
})(typeof window !== 'undefined' ? window : globalThis);
