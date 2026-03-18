const REVIEW_MODE_ENABLED = true;

if (REVIEW_MODE_ENABLED) {
  document.documentElement.dataset.siteMode = "review";

  console.info(
    "FiberCop Map: review mode temporanea attiva. Mappa e caricamento dati pubblici disattivati."
  );
}
