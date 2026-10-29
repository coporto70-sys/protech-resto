/* Protech Resto · tema "Academia Arcana" (aprendiz de mago): del 24 de octubre al 2 de noviembre reemplaza el fondo de Halloween.
   Apagar el tema en este equipo: localStorage 'pr-robi-tema' = 'bruja' (vuelve el fondo de Halloween) o 'pr-robi-hw' = '0' (todo apagado). */
(function () {
  try {
    if (localStorage.getItem('pr-robi-hw') === '0' || localStorage.getItem('pr-robi-tema') === 'bruja') return;
    var f = new Date(), m = f.getMonth(), d = f.getDate();
    if ((m === 9 && d >= 24) || (m === 10 && d <= 2)) {
      var h = document.documentElement;
      h.classList.remove('hw');
      h.classList.add('mg');
    }
  } catch (e) {}
})();
