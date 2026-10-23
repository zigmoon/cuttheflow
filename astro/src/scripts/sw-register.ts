/**
 * Enregistrement du service worker et **proposition de mise à jour**.
 *
 * Le worker ne prend jamais la main de lui-même : il attend. C'est ce module qui
 * détecte qu'une nouvelle version est prête (`registration.waiting`), affiche le
 * bandeau, et ne bascule qu'au clic — un rechargement surprise au milieu d'un
 * montage serait pire que pas de mise à jour du tout.
 *
 * Uniquement en production : en développement (`astro dev`), un worker qui met
 * `index.html` en cache masquerait les changements. L'échec est silencieux :
 * sans service worker le studio reste entièrement fonctionnel.
 */

import { t } from './i18n';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CHECK_MIN_GAP_MS = 5 * 60 * 1000;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  const scriptUrl = new URL('service-worker.js', document.baseURI).toString();
  const banner = document.getElementById('updateBanner');
  const reloadBtn = document.getElementById('updateReload') as HTMLButtonElement | null;
  const dismissBtn = document.getElementById('updateDismiss');
  const text = document.getElementById('updateText');

  let registration: ServiceWorkerRegistration | null = null;
  /** Vrai quand l'utilisateur a demandé la bascule : seul cas de rechargement. */
  let reloadPending = false;
  /**
   * La page était-elle déjà pilotée par un worker au chargement ? Sur la toute
   * première visite, `clients.claim()` déclenche aussi `controllerchange` : ce
   * n'est pas une mise à jour, il ne faut pas annoncer « le studio a été mis à
   * jour » à quelqu'un qui l'ouvre pour la première fois.
   */
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastCheck = 0;
  let dismissed = false;

  const show = (message: string, action: string): void => {
    if (!banner || !text || !reloadBtn) return;
    text.textContent = message;
    reloadBtn.textContent = action;
    reloadBtn.disabled = false;
    banner.hidden = false;
  };

  const hide = (): void => {
    if (banner) banner.hidden = true;
  };

  /** Une mise à jour est prête mais attend son activation. */
  const offerUpdate = (): void => {
    if (dismissed) return;
    show(t('sw.ready'), t('sw.reload'));
  };

  /** Un nouveau worker a déjà pris la main (autre onglet) : page en retard. */
  const offerReload = (): void => {
    if (dismissed) return;
    show(t('sw.activated'), t('sw.reloadNow'));
  };

  const activate = (): void => {
    const waiting = registration?.waiting;
    reloadPending = true;
    if (reloadBtn) reloadBtn.disabled = true;
    if (text) text.textContent = t('sw.updating');
    if (!waiting) {
      // Le worker est déjà actif : la page est simplement en retard.
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Filet : si `controllerchange` n'arrive pas (worker bloqué), on recharge
    // quand même — le pire serait un bandeau figé sur « mise à jour… ».
    window.setTimeout(() => {
      if (reloadPending) window.location.reload();
    }, 4000);
  };

  reloadBtn?.addEventListener('click', activate);
  dismissBtn?.addEventListener('click', () => {
    dismissed = true;
    hide();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadPending) {
      // Un autre onglet a activé la nouvelle version : on prévient sans forcer.
      // À la première visite il n'y avait pas de contrôleur : rien à annoncer.
      if (hadController) offerReload();
      return;
    }
    reloadPending = false;
    window.location.reload();
  });

  const check = (force = false): void => {
    if (!registration) return;
    const now = Date.now();
    if (!force && now - lastCheck < CHECK_MIN_GAP_MS) return;
    lastCheck = now;
    void registration.update().catch(() => undefined);
  };

  const track = (reg: ServiceWorkerRegistration): void => {
    registration = reg;

    // Une mise à jour déjà prête au chargement de la page.
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // « installed » + un contrôleur existant = mise à jour, pas 1re visite.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate();
        }
      });
    });
  };

  const register = () => {
    navigator.serviceWorker
      .register(scriptUrl, { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        track(reg);
        check(true);
        // Vérification périodique, et au retour sur l'onglet : c'est là qu'on
        // reprend un montage, donc le bon moment pour proposer la mise à jour.
        window.setInterval(() => {
          if (document.visibilityState === 'visible') check();
        }, CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        window.addEventListener('online', () => check(true));
      })
      .catch(() => {
        // Hébergement sans HTTPS, ou worker refusé : aucun impact sur l'édition.
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
