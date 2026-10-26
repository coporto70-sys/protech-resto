/* Protech Resto · activa el fondo de Halloween del 24 de octubre al 2 de noviembre. Apagar en este equipo: localStorage 'pr-robi-hw' = '0'. */
(function () {
  try {
    if (localStorage.getItem('pr-robi-hw') === '0') return;
    var f = new Date(), m = f.getMonth(), d = f.getDate();
    if ((m === 9 && d >= 24) || (m === 10 && d <= 2)) document.documentElement.classList.add('hw');
  } catch (e) {}
})();
