import {
  SONGBIRD_COPY,
  isSongbird2077Active,
  earthMoonL1Fraction,
} from './songbird-2077.js';

/**
 * Modular UI helper for the 2077 Songbird / Crystal Palace landmark brief card.
 * Keeps `main.js` focused on scene orchestration and updates the radio button
 * in place so toggling audio never resets scroll position on small screens.
 */
export function createSongbirdBriefController({
  briefElement,
  slotElement,
  getDate,
  getMoonEarthDistanceKm,
  radio,
}) {
  let renderedKey = '';

  function syncRadioButton() {
    const btn = slotElement?.querySelector('.landmark-brief-easter-btn');
    if (!btn) return;
    const playing = Boolean(radio?.isPlaying());
    btn.setAttribute('aria-pressed', String(playing));
    btn.textContent = playing
      ? SONGBIRD_COPY.tycho2077.radioLabelStop
      : SONGBIRD_COPY.tycho2077.radioLabelPlay;
  }

  function clear() {
    renderedKey = '';
    if (briefElement) briefElement.classList.remove('easter-2077');
    if (slotElement) {
      slotElement.replaceChildren();
      slotElement.hidden = true;
    }
    radio?.stop();
  }

  function update(feature) {
    if (!slotElement || !briefElement) return;
    const active = isSongbird2077Active(getDate());
    if (!feature || feature.easterEgg !== 'songbird-2077' || !active) {
      clear();
      return;
    }

    const nextKey = `${feature.id}:2077`;
    briefElement.classList.add('easter-2077');
    slotElement.hidden = false;

    if (renderedKey === nextKey) {
      if (feature.id === 'tycho') syncRadioButton();
      if (feature.id === 'crystal-palace-l1') {
        const readout = slotElement.querySelector('[data-l1-readout]');
        if (readout) {
          const km = getMoonEarthDistanceKm() * earthMoonL1Fraction().moonFraction;
          readout.textContent = `当前 L1 距月球约 ${(km / 10000).toFixed(2)} 万公里`;
        }
      }
      return;
    }

    renderedKey = nextKey;
    slotElement.replaceChildren();

    if (feature.id === 'tycho') {
      const copy = SONGBIRD_COPY.tycho2077;
      const head = document.createElement('div');
      head.className = 'landmark-brief-easter-head';
      const img = document.createElement('img');
      img.className = 'landmark-brief-easter-badge';
      img.src = copy.badge;
      img.alt = copy.badgeAlt;
      img.width = 40;
      img.height = 40;
      const headerText = document.createElement('div');
      const eyebrow = document.createElement('span');
      eyebrow.className = 'landmark-brief-easter-eyebrow';
      eyebrow.textContent = copy.eyebrow;
      headerText.append(eyebrow);
      head.append(img, headerText);

      const quote = document.createElement('p');
      quote.className = 'landmark-brief-easter-quote';
      quote.textContent = copy.message;

      const meta = document.createElement('small');
      meta.className = 'landmark-brief-easter-meta';
      meta.textContent = copy.meta;

      const radioBtn = document.createElement('button');
      radioBtn.type = 'button';
      radioBtn.className = 'landmark-brief-easter-btn';
      radioBtn.addEventListener('click', () => {
        radio?.toggle();
        syncRadioButton();
      });

      slotElement.append(head, quote, meta, radioBtn);
      syncRadioButton();
    } else if (feature.id === 'crystal-palace-l1') {
      const copy = SONGBIRD_COPY.crystalPalace2077;
      const moonDistKm = getMoonEarthDistanceKm() * earthMoonL1Fraction().moonFraction;

      const head = document.createElement('div');
      head.className = 'landmark-brief-easter-head';
      const img = document.createElement('img');
      img.className = 'landmark-brief-easter-badge';
      img.src = copy.badge;
      img.alt = copy.badgeAlt;
      img.width = 40;
      img.height = 40;
      const headerText = document.createElement('div');
      const eyebrow = document.createElement('span');
      eyebrow.className = 'landmark-brief-easter-eyebrow';
      eyebrow.textContent = copy.eyebrow;
      const readout = document.createElement('small');
      readout.className = 'landmark-brief-easter-meta';
      readout.dataset.l1Readout = 'true';
      readout.textContent = `当前 L1 距月球约 ${(moonDistKm / 10000).toFixed(2)} 万公里`;
      headerText.append(eyebrow, readout);
      head.append(img, headerText);

      const quote = document.createElement('p');
      quote.className = 'landmark-brief-easter-quote';
      quote.textContent = copy.message;

      const meta = document.createElement('small');
      meta.className = 'landmark-brief-easter-meta';
      meta.textContent = copy.meta;

      slotElement.append(head, quote, meta);
    } else if (feature.id === 'mare-tranquillitatis') {
      const copy = SONGBIRD_COPY.tranquillitatis2077;
      const eyebrow = document.createElement('span');
      eyebrow.className = 'landmark-brief-easter-eyebrow';
      eyebrow.textContent = copy.eyebrow;
      const quote = document.createElement('p');
      quote.className = 'landmark-brief-easter-quote';
      quote.textContent = copy.message;
      const meta = document.createElement('small');
      meta.className = 'landmark-brief-easter-meta';
      meta.textContent = copy.meta;
      slotElement.append(eyebrow, quote, meta);
    }
  }

  return {
    update,
    syncRadioButton,
    clear,
  };
}
