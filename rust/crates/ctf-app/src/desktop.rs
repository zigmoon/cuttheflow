//! Fenêtre native du studio.
//!
//! L'interface reste une page web servie par le serveur local : ce module ne
//! remplace pas le moteur, il remplace **le navigateur**. On embarque le WebView
//! du système — WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous
//! Linux — dans une fenêtre qui appartient à l'application : ni onglets, ni
//! barre d'adresse, ni dépendance à Chrome ou Edge installés.
//!
//! Compilé uniquement avec l'option `desktop` : sans elle, le binaire reste un
//! serveur (utile pour un Linux statique ou une machine sans environnement
//! graphique).

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use wry::WebViewBuilder;

const TITLE: &str = "CUT THE FLOW";
const DEFAULT_WIDTH: f64 = 1500.0;
const DEFAULT_HEIGHT: f64 = 940.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 640.0;

/// Ouvre la fenêtre et bloque jusqu'à sa fermeture.
pub fn run(url: &str) -> Result<(), String> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title(TITLE)
        .with_inner_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT))
        .with_min_inner_size(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT))
        .build(&event_loop)
        .map_err(|e| format!("fenêtre impossible : {e}"))?;

    let builder = WebViewBuilder::new().with_url(url).with_devtools(cfg!(debug_assertions));

    // Linux : le WebView est un widget GTK qu'il faut poser dans la fenêtre.
    #[cfg(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    ))]
    let webview = builder
        .build(&window)
        .map_err(|e| format!("WebView impossible : {e}"))?;

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .ok_or_else(|| "GTK : conteneur absent".to_string())?;
        builder
            .build_gtk(vbox)
            .map_err(|e| format!("WebView impossible : {e}"))?
    };

    // La WebView doit survivre à la boucle : on la garde vivante jusqu'à la fin.
    let _webview = webview;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
