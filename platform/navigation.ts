import { createElement, Orbit, Aperture, Sparkles, ChevronDown, Check } from 'lucide';
import { scenes, sceneById } from './scenes.js';
import './style.css';
import './controls.css';

export function mountNavigation(id: string) {
  const host = document.getElementById('scene-navigation');
  const scene = sceneById(id);
  if (!host || !scene) return () => {};
  const events = new AbortController();
  const options = { signal: events.signal };
  document.documentElement.dataset.scene = id;
  host.innerHTML = `<button id="scene-switcher" type="button" popovertarget="scene-menu" aria-label="切换探索场景，当前${scene.name}" aria-expanded="false" aria-controls="scene-menu">
    <span class="space-atlas-mark" aria-hidden="true"></span><span class="space-atlas-title">星际图鉴<small>${scene.name} / ${scene.english}</small></span><span class="space-atlas-chevron" aria-hidden="true"></span>
  </button>`;
  const button = host.querySelector<HTMLButtonElement>('button')!;
  host.querySelector('.space-atlas-mark')!.append(createElement(Orbit));
  host.querySelector('.space-atlas-chevron')!.append(createElement(ChevronDown));
  const menu = document.createElement('nav');
  menu.id = 'scene-menu';
  menu.popover = 'auto';
  menu.setAttribute('aria-label', '探索场景');
  menu.innerHTML = `<div class="space-atlas-menu-title">探索目的地</div>`;
  for (const item of scenes) {
    const link = document.createElement('a');
    link.href = item.path;
    link.dataset.sceneLink = item.id;
    link.innerHTML = `<span class="space-atlas-destination-icon" aria-hidden="true"></span><span>${item.name}<small>${item.english}</small></span>`;
    link.querySelector('.space-atlas-destination-icon')!.append(createElement(item.icon === 'aperture' ? Aperture : item.icon === 'sparkles' ? Sparkles : Orbit));
    if (item.id === id) { link.setAttribute('aria-current', 'page'); link.append(createElement(Check)); }
    menu.append(link);
  }
  document.getElementById('app')!.append(menu);
  const position = () => {
    const anchor = button.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - Math.min(292, innerWidth - 24) - 12))}px`;
    menu.style.top = `${anchor.bottom + 12}px`;
    menu.style.maxHeight = `${Math.max(100, innerHeight - anchor.bottom - 28)}px`;
  };
  button.addEventListener('click', position, options);
  window.addEventListener('resize', position, options);
  menu.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(menu.matches(':popover-open'))), options);
  // Handle menu keys before a scene interprets Escape as a camera reset.
  document.addEventListener('keydown', (event) => {
    if (!menu.matches(':popover-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); menu.hidePopover(); button.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopImmediatePropagation();
      const links = [...menu.querySelectorAll('a')];
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      links[(current + (event.key === 'ArrowDown' ? 1 : links.length - 1) + links.length) % links.length].focus();
    }
  }, { ...options, capture: true });
  menu.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    menu.hidePopover();
    if (link.dataset.sceneLink === id) { button.focus(); return; }
    window.dispatchEvent(new Event('space-atlas:leaving'));
    location.assign(link.href);
  }, options);
  return () => { events.abort(); menu.remove(); host.replaceChildren(); };
}
