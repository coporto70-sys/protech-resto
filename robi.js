/* Protech Resto · Robi, el robot guía de caja
   Acompaña a quien abre y cierra la caja: dice qué hacer ahora y avisa, con cariño, si algo no cuadra.
   Los textos y las cifras salen SOLO de reglas fijas (nunca de una IA), igual que los avisos de control de caja.
   Es solo una guía: no guarda, no corrige ni mueve dinero. La voz usa la voz del propio dispositivo (speechSynthesis). */
(function (root) {
  const $ = n => '$' + Math.round(n).toLocaleString('es-CL');
  const dif = (d, que) => (d > 0 ? 'sobran ' : 'faltan ') + $(Math.abs(d)) + (que ? ' ' + que : '');

  /* Entrada (todo ya calculado por la app):
     { quien, fondo, turno: null | {monto_inicial, abierto_h}, apertura: {total, escribio},
       res: {cuentas, vt, esp, tj, tr, pp}, cierre: {escribio, ef, tj, tr, dj, hayD} }
     Salida: { tono: 'ok'|'aviso'|'mal'|'hola', txt, paso } */
  function mensaje(c) {
    const nom = c.quien ? ', ' + c.quien : '';
    const fondo = c.fondo || 0;

    // ---- Caja cerrada: guía de apertura ----
    if (!c.turno) {
      const a = c.apertura || {};
      if (!a.escribio) {
        return { tono: 'hola', paso: 'Apertura · paso 1 de 2',
          txt: '¡Hola' + nom + '! Vamos a abrir la caja. Cuenta el sencillo billete por billete y escríbelo abajo.' + (fondo ? ' Debes recibir ' + $(fondo) + '.' : '') };
      }
      if (fondo && a.total !== fondo) {
        return { tono: 'aviso', paso: 'Apertura · paso 1 de 2',
          txt: 'Ojo: ' + dif(a.total - fondo, 'respecto del sencillo fijo de ' + $(fondo)) + '. Vuelve a contar con calma antes de abrir. Si el sencillo realmente cambió, avísale a la administradora.' };
      }
      return { tono: 'ok', paso: 'Apertura · paso 2 de 2',
        txt: '¡Perfecto! ' + (fondo ? 'El sencillo coincide con ' + $(fondo) + '. ' : 'Abres con ' + $(a.total) + '. ') + 'Ahora toca el botón verde "Abrir caja".' };
    }

    // ---- Caja abierta ----
    const t = c.turno, r = c.res || {}, k = c.cierre || {};
    const avisos = [];
    if (fondo && !(t.monto_inicial > 0)) avisos.push('Esta caja se abrió sin registrar sencillo, por eso el cierre puede mostrar una diferencia que no es real. Avísale a la administradora.');
    if (t.abierto_h > 16) avisos.push('Este turno lleva ' + Math.round(t.abierto_h) + ' horas abierto. Conviene cerrar la caja al terminar cada día.');

    if (!k.escribio && k.tj == null && k.tr == null) {
      const base = 'Caja abierta. Van ' + (r.cuentas || 0) + (r.cuentas === 1 ? ' cuenta' : ' cuentas') + ' y ' + $(r.vt || 0) + ' vendidos. Cuando termine el día, te guío para cerrar.';
      const pp = r.pp ? ' Antes de contar, paga ' + $(r.pp) + ' de propinas a los garzones.' : '';
      return { tono: avisos.length ? 'aviso' : 'hola', paso: 'Caja abierta', txt: [base + pp].concat(avisos).join(' ') };
    }

    // Cierre en curso: revisa en este orden y dice lo primero que no cuadra
    const pasos = [];
    if (k.escribio && r.esp != null && k.ef !== r.esp) pasos.push({ tono: 'mal', txt: 'En efectivo ' + dif(k.ef - r.esp) + '. Recuenta los billetes y las monedas. Recuerda que el sistema ya descontó gastos, retiros y propinas pagadas.' });
    if (k.tj != null && k.tj !== r.tj) pasos.push({ tono: 'mal', txt: 'Las tarjetas no cuadran: ' + dif(k.tj - r.tj) + '. Mira el comprobante de la máquina y confirma que sea solo de este turno.' });
    if (k.tr != null && k.tr !== r.tr) pasos.push({ tono: 'mal', txt: 'Las transferencias no cuadran: ' + dif(k.tr - r.tr) + '. Revisa lo recibido en el banco durante el turno.' });
    if (k.hayD && fondo && k.dj !== fondo) pasos.push({ tono: 'aviso', txt: 'El sencillo que dejas en caja debería ser ' + $(fondo) + ' y pusiste ' + $(k.dj) + '.' });
    if (k.escribio && !k.hayD) pasos.push({ tono: 'aviso', txt: 'Falta anotar el sencillo que queda en la caja' + (fondo ? ' (debe ser ' + $(fondo) + ')' : '') + '.' });
    if (k.escribio && k.tj == null) pasos.push({ tono: 'aviso', txt: 'Falta anotar el total de tarjetas del terminal (escribe 0 si no hubo).' });
    if (k.escribio && k.tr == null) pasos.push({ tono: 'aviso', txt: 'Falta anotar las transferencias recibidas (escribe 0 si no hubo).' });
    if (!k.escribio) pasos.push({ tono: 'aviso', txt: 'Ahora cuenta el efectivo de la caja' + (r.esp != null ? '. Debe haber ' + $(r.esp) : '') + '.' });

    const mal = pasos.find(p => p.tono === 'mal');
    if (mal) return { tono: 'mal', paso: 'Cierre de caja', txt: mal.txt + ' Cuando termines, escribe una observación para explicar la diferencia.' };
    if (pasos.length) return { tono: 'aviso', paso: 'Cierre de caja', txt: pasos[0].txt };
    return { tono: 'ok', paso: 'Cierre de caja', txt: '¡Todo cuadra' + nom + '! Escribe una observación si quieres y toca "Cerrar caja". ¡Buen trabajo hoy!' };
  }

  /* El robot: cuerpo redondeado, antena con corazón, ojos grandes, sonrisa y mejillas. Diseño propio de Protech. */
  function svg(tono, habla) {
    const boca = tono === 'mal' ? 'M42 62 Q50 56 58 62' : tono === 'aviso' ? 'M42 60 L58 60' : 'M40 58 Q50 68 60 58';
    const cejas = tono === 'mal' ? '<path d="M33 37 L43 41 M67 37 L57 41" stroke="#7c2d12" stroke-width="2.5" stroke-linecap="round"/>' : '';
    return '<svg class="robi-svg' + (habla ? ' habla' : '') + '" viewBox="0 0 100 110" aria-hidden="true" focusable="false">' +
      '<line x1="50" y1="14" x2="50" y2="24" stroke="#78716c" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="robi-cor" d="M50 14 C44 5 34 9 38 16 C41 21 50 25 50 25 C50 25 59 21 62 16 C66 9 56 5 50 14Z" fill="#f43f5e"/>' +
      '<rect x="22" y="24" width="56" height="52" rx="20" fill="#fff7ed" stroke="#d9480f" stroke-width="3.5"/>' +
      '<rect x="14" y="40" width="8" height="18" rx="4" fill="#d9480f"/><rect x="78" y="40" width="8" height="18" rx="4" fill="#d9480f"/>' +
      '<g class="robi-ojos"><ellipse cx="38" cy="46" rx="6.5" ry="7.5" fill="#1f1814"/><ellipse cx="62" cy="46" rx="6.5" ry="7.5" fill="#1f1814"/>' +
      '<circle cx="40" cy="43.5" r="2.3" fill="#fff"/><circle cx="64" cy="43.5" r="2.3" fill="#fff"/></g>' + cejas +
      '<circle cx="29" cy="58" r="4.5" fill="#fda4af" opacity=".75"/><circle cx="71" cy="58" r="4.5" fill="#fda4af" opacity=".75"/>' +
      '<path class="robi-boca" d="' + boca + '" fill="none" stroke="#7c2d12" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="30" y="78" width="40" height="26" rx="10" fill="#d9480f"/>' +
      '<path d="M50 99 C45 93 39 96 42 91 C44 88 50 91 50 91 C50 91 56 88 58 91 C61 96 55 93 50 99Z" fill="#fff7ed"/>' +
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

  const api = { mensaje, svg, voz };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Robi = api;
})(typeof window !== 'undefined' ? window : globalThis);
