const app = document.querySelector("#app");
let token = localStorage.getItem("vf_token"),
  me = null,
  users = [];
let supportChatTimer = null;
let supportBadgeTimer = null;
let adminSupportInboxTimer = null;
let adminSupportChatTimer = null;
let adminSupportConversationId = null;
const SESSION_IDLE_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = "vf_last_activity";
let lastHeartbeatAt = 0;
function clearLocalSession() {
  [supportChatTimer, supportBadgeTimer, adminSupportInboxTimer, adminSupportChatTimer].forEach((timer) => timer && clearInterval(timer));
  supportChatTimer = null;
  supportBadgeTimer = null;
  adminSupportInboxTimer = null;
  adminSupportChatTimer = null;
  activeSupportConversation = null;
  adminSupportConversationId = null;
  localStorage.removeItem("vf_token");
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  token = null;
  me = null;
}
function checkIdleSession() {
  if (!token) return false;
  const lastActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  if (!lastActivityAt || Date.now() - lastActivityAt >= SESSION_IDLE_MS) {
    clearLocalSession();
    landing();
    return true;
  }
  return false;
}
function recordActivity() {
  if (!token || checkIdleSession()) return;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  if (Date.now() - lastHeartbeatAt < 60_000) return;
  lastHeartbeatAt = Date.now();
  fetch("/api/auth/heartbeat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((response) => {
    if (response.status === 401 && token) {
      clearLocalSession();
      landing();
    }
  }).catch(() => {});
}
for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
  window.addEventListener(eventName, recordActivity, { passive: true });
}
window.addEventListener("focus", checkIdleSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkIdleSession();
});
window.setInterval(checkIdleSession, 15_000);
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: `Server returned ${response.status} instead of JSON.` };
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
function inAppDialog({ title, message, confirmLabel = "OK", cancelLabel }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-bg device-dialog-bg";
    backdrop.innerHTML = `<section class="modal confirm-modal device-dialog" role="alertdialog" aria-modal="true" aria-labelledby="deviceDialogTitle" aria-describedby="deviceDialogMessage"><div class="modal-head"><h2 id="deviceDialogTitle"></h2>${cancelLabel ? '<button class="close" type="button" aria-label="Close">×</button>' : ""}</div><p class="confirm-copy" id="deviceDialogMessage"></p><div class="confirm-actions">${cancelLabel ? '<button class="action secondary device-dialog-cancel" type="button"></button>' : ""}<button class="${cancelLabel ? "danger" : "primary"} device-dialog-confirm" type="button"></button></div></section>`;
    backdrop.querySelector("h2").textContent = title;
    backdrop.querySelector("#deviceDialogMessage").textContent = message;
    backdrop.querySelector(".device-dialog-confirm").textContent = confirmLabel;
    if (cancelLabel)
      backdrop.querySelector(".device-dialog-cancel").textContent = cancelLabel;
    document.body.append(backdrop);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(result);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(false);
    };
    backdrop.querySelector(".device-dialog-confirm").addEventListener("click", () => finish(true));
    backdrop.querySelector(".device-dialog-cancel")?.addEventListener("click", () => finish(false));
    backdrop.querySelector(".close")?.addEventListener("click", () => finish(false));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
    document.addEventListener("keydown", onKeyDown);
    backdrop.querySelector(cancelLabel ? ".device-dialog-cancel" : ".device-dialog-confirm").focus();
  });
}
function showNotice(message, title = "Please try again") {
  return inAppDialog({ title, message });
}
function confirmInApp(message, title = "Please confirm") {
  return inAppDialog({
    title,
    message,
    confirmLabel: "Delete account",
    cancelLabel: "Keep account",
  });
}
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0,
  );
const initials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
let livePrices = {
  BTC: { usd: 66008.36, change: 0 },
  ETH: { usd: 3506.02, change: 0 },
  USDC: { usd: 1, change: 0 },
  USDT: { usd: 1, change: 0 },
};
let priceTimer = null;
let sendMethod = "wallet";
const meta = {
  BTC: ["₿", "Bitcoin", ""],
  ETH: ["◆", "Ethereum", "eth"],
  USDC: ["$", "USD Coin", "usdc"],
  USDT: ["₮", "Tether", "usdc"],
};
const receiveAddresses = {
  BTC: ["Bitcoin", "bc1qtndhsmj0p8ka2y4xqtagx0z5vl92vu0mun5kve"],
  ETH: ["Ethereum (ERC20)", "0xA985b9a974d8933CFeE908EbD6E07E9Dd6F635dC"],
  USDT: ["Tether (TRC20)", "TGFgh3tAatcrtJKu86BM7m1DkmufVAUhp9"],
  USDC: ["USD Coin (ERC20)", "0xA985b9a974d8933CFeE908EbD6E07E9Dd6F635dC"],
};
const options = Object.keys(meta)
  .map((s) => `<option value="${s}">${s} — ${meta[s][1]}</option>`)
  .join("");
const brand = `<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3.5 27 10v12L16 28.5 5 22V10l11-6.5Z" fill="currentColor" opacity=".22"/><path d="M10 12.4 16 9l6 3.4v7.2L16 23l-6-3.4v-7.2Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 9v14M10 12.4l6 3.5 6-3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>OnchainVault</div>`;

const landingTranslations = {
  en: ["Language", "Sign in", "Get started", "Your assets, your flow", "Recover the next", "with confidence.", "A considered home for your digital assets. Track live markets, manage your Vault, and move only when you are ready.", "Create free account", "View your Vault", "Private account data", "Admin-reviewed funding", "Vault overview", "12.4% this month", "Live market", "Stable value", "Live market snapshot", "Markets at a glance.", "Updating prices…", "One clear Vault", "See your live asset values and your exact holdings without losing the signal in the noise.", "Controlled deposits", "Funding requests remain pending until they are reviewed and confirmed on the blockchain.", "Account-level privacy", "Every dashboard and activity history belongs only to the account that created it.", "Built with intention", "Your Vault, in focus.", "OnchainVault keeps the practical details close: current market value, exact balances, and a transparent activity trail.", "Start your vault"],
  es: ["Idioma", "Iniciar sesión", "Comenzar", "Tus activos, a tu ritmo", "Prepárate para lo que viene", "con confianza.", "Un espacio pensado para tus activos digitales. Sigue los mercados en vivo, gestiona tu Vault y actúa cuando estés listo.", "Crear cuenta gratis", "Ver tu Vault", "Datos privados de la cuenta", "Fondos revisados por el administrador", "Resumen del Vault", "12,4 % este mes", "Mercado en vivo", "Valor estable", "Resumen del mercado en vivo", "Los mercados de un vistazo.", "Actualizando precios…", "Un Vault claro", "Consulta el valor de tus activos y tus tenencias exactas sin perder de vista lo importante.", "Depósitos controlados", "Las solicitudes de fondos quedan pendientes hasta que se revisen y confirmen en la cadena de bloques.", "Privacidad por cuenta", "Cada panel y cada historial pertenecen únicamente a la cuenta que los creó.", "Diseñado con intención", "Tu Vault, en primer plano.", "OnchainVault reúne lo esencial: valor actual, saldos exactos y un historial transparente.", "Abre tu Vault"],
  fr: ["Langue", "Se connecter", "Commencer", "Vos actifs, à votre rythme", "Préparez la suite", "en toute confiance.", "Un espace pensé pour vos actifs numériques. Suivez les marchés en direct, gérez votre Vault et agissez quand vous le souhaitez.", "Créer un compte gratuit", "Voir votre Vault", "Données privées du compte", "Financement vérifié par un administrateur", "Aperçu du Vault", "12,4 % ce mois-ci", "Marché en direct", "Valeur stable", "Aperçu du marché en direct", "Les marchés en un coup d’œil.", "Mise à jour des prix…", "Un Vault clair", "Consultez la valeur de vos actifs et vos avoirs exacts sans perdre l’essentiel de vue.", "Dépôts contrôlés", "Les demandes de financement restent en attente jusqu’à leur examen et leur confirmation sur la blockchain.", "Confidentialité par compte", "Chaque tableau de bord et historique appartient uniquement au compte qui l’a créé.", "Conçu avec soin", "Votre Vault, au premier plan.", "OnchainVault rassemble l’essentiel : valeur actuelle, soldes exacts et historique transparent.", "Créer votre Vault"],
  de: ["Sprache", "Anmelden", "Loslegen", "Deine Assets, dein Tempo", "Gut vorbereitet auf das, was kommt", "mit Vertrauen.", "Ein durchdachter Ort für deine digitalen Assets. Verfolge Live-Märkte, verwalte deinen Vault und handle erst, wenn du bereit bist.", "Kostenloses Konto erstellen", "Deinen Vault ansehen", "Private Kontodaten", "Von Admins geprüfte Einzahlungen", "Vault-Übersicht", "12,4 % diesen Monat", "Live-Markt", "Stabiler Wert", "Live-Marktüberblick", "Märkte auf einen Blick.", "Preise werden aktualisiert…", "Ein klarer Vault", "Sieh den aktuellen Wert deiner Assets und deine genauen Bestände, ohne das Wesentliche aus den Augen zu verlieren.", "Kontrollierte Einzahlungen", "Einzahlungsanfragen bleiben offen, bis sie geprüft und auf der Blockchain bestätigt wurden.", "Datenschutz auf Kontoebene", "Jedes Dashboard und jeder Aktivitätsverlauf gehört nur dem Konto, das ihn erstellt hat.", "Mit Bedacht entwickelt", "Dein Vault im Fokus.", "OnchainVault zeigt das Wesentliche: aktuellen Marktwert, genaue Guthaben und einen transparenten Verlauf.", "Vault starten"],
  pt: ["Idioma", "Entrar", "Começar", "Seus ativos, no seu ritmo", "Prepare-se para o próximo passo", "com confiança.", "Um espaço pensado para seus ativos digitais. Acompanhe os mercados ao vivo, gerencie seu Vault e aja quando estiver pronto.", "Criar conta grátis", "Ver seu Vault", "Dados privados da conta", "Depósitos revisados pelo administrador", "Visão geral do Vault", "12,4% neste mês", "Mercado ao vivo", "Valor estável", "Resumo do mercado ao vivo", "Mercados em um relance.", "Atualizando preços…", "Um Vault transparente", "Veja o valor atual dos seus ativos e seus saldos exatos sem perder o que importa.", "Depósitos controlados", "Solicitações de depósito ficam pendentes até serem analisadas e confirmadas na blockchain.", "Privacidade por conta", "Cada painel e histórico pertence somente à conta que o criou.", "Feito com propósito", "Seu Vault em foco.", "O OnchainVault reúne o essencial: valor atual, saldos exatos e um histórico transparente.", "Comece seu Vault"],
  it: ["Lingua", "Accedi", "Inizia", "I tuoi asset, al tuo ritmo", "Preparati al prossimo passo", "con fiducia.", "Uno spazio pensato per i tuoi asset digitali. Segui i mercati in tempo reale, gestisci il tuo Vault e agisci quando vuoi.", "Crea un account gratuito", "Visualizza il Vault", "Dati privati dell’account", "Depositi verificati dall’amministratore", "Panoramica Vault", "12,4% questo mese", "Mercato in tempo reale", "Valore stabile", "Panoramica del mercato", "I mercati a colpo d’occhio.", "Aggiornamento prezzi…", "Un Vault chiaro", "Consulta il valore aggiornato dei tuoi asset e i saldi esatti senza perdere di vista ciò che conta.", "Depositi controllati", "Le richieste di deposito restano in sospeso finché non vengono verificate e confermate sulla blockchain.", "Privacy per account", "Ogni dashboard e cronologia appartiene solo all’account che l’ha creata.", "Pensato con cura", "Il tuo Vault, in primo piano.", "OnchainVault mette in evidenza ciò che conta: valore attuale, saldi esatti e uno storico trasparente.", "Avvia il tuo Vault"],
  nl: ["Taal", "Inloggen", "Aan de slag", "Jouw assets, jouw tempo", "Klaar voor de volgende stap", "met vertrouwen.", "Een doordachte plek voor je digitale assets. Volg live markten, beheer je Vault en kom in beweging wanneer jij er klaar voor bent.", "Gratis account maken", "Bekijk je Vault", "Privéaccountgegevens", "Stortingen gecontroleerd door beheerder", "Vault-overzicht", "12,4% deze maand", "Live markt", "Stabiele waarde", "Live marktoverzicht", "Markten in één oogopslag.", "Prijzen bijwerken…", "Een helder Vault", "Bekijk de actuele waarde van je assets en je exacte bezit zonder de kern uit het oog te verliezen.", "Gecontroleerde stortingen", "Stortingsaanvragen blijven openstaan totdat ze zijn beoordeeld en bevestigd op de blockchain.", "Privacy per account", "Elk dashboard en elke activiteitengeschiedenis hoort alleen bij het account dat deze heeft aangemaakt.", "Doordacht gebouwd", "Jouw Vault in beeld.", "OnchainVault houdt de praktische details dichtbij: actuele marktwaarde, exacte saldi en een transparant overzicht.", "Start je Vault"],
  tr: ["Dil", "Giriş yap", "Başla", "Varlıkların, senin akışın", "Sıradakine hazır ol", "güvenle.", "Dijital varlıkların için özenle tasarlanmış bir alan. Canlı piyasaları izle, Vault’unu yönet ve hazır olduğunda harekete geç.", "Ücretsiz hesap oluştur", "Vault’unu görüntüle", "Hesap verileri gizlidir", "Yönetici tarafından incelenen yatırımlar", "Vault özeti", "Bu ay %12,4", "Canlı piyasa", "Sabit değer", "Canlı piyasa özeti", "Piyasalara genel bakış.", "Fiyatlar güncelleniyor…", "Sade bir Vault", "Önemli bilgileri kaçırmadan varlıklarının canlı değerini ve kesin bakiyelerini gör.", "Kontrollü yatırımlar", "Yatırım talepleri incelenip blokzincirde doğrulanana kadar beklemede kalır.", "Hesap düzeyinde gizlilik", "Her pano ve işlem geçmişi yalnızca onu oluşturan hesaba aittir.", "Özenle tasarlandı", "Vault’un ön planda.", "OnchainVault güncel piyasa değerini, kesin bakiyeleri ve şeffaf işlem geçmişini bir arada sunar.", "Vault’unu başlat"],
  ar: ["اللغة", "تسجيل الدخول", "ابدأ الآن", "أصولك، على طريقتك", "استعد للخطوة التالية", "بثقة.", "مساحة مصممة لأصولك الرقمية. تابع الأسواق مباشرة، وأدر خزنتك، وتحرك عندما تكون مستعدًا.", "إنشاء حساب مجاني", "عرض خزنتك", "بيانات الحساب خاصة", "تمويل بمراجعة المسؤول", "نظرة عامة على الخزنة", "١٢٫٤٪ هذا الشهر", "السوق مباشر", "قيمة مستقرة", "لمحة عن السوق المباشر", "الأسواق في لمحة.", "جارٍ تحديث الأسعار…", "خزنة واضحة", "تابع قيمة أصولك وأرصدتك الدقيقة دون أن تفقد رؤية التفاصيل المهمة.", "إيداعات خاضعة للمراجعة", "تظل طلبات التمويل معلقة حتى مراجعتها وتأكيدها على البلوك تشين.", "خصوصية على مستوى الحساب", "تعود كل لوحة وسجل نشاط إلى الحساب الذي أنشأهما فقط.", "صُمم بعناية", "خزنتك في الواجهة.", "يجمع OnchainVault التفاصيل المهمة: القيمة الحالية والأرصدة الدقيقة وسجل النشاط الشفاف.", "ابدأ خزنتك"],
  hi: ["भाषा", "साइन इन", "शुरू करें", "आपकी संपत्तियाँ, आपकी गति", "अगले कदम के लिए तैयार", "विश्वास के साथ।", "आपकी डिजिटल संपत्तियों के लिए एक सुविचारित जगह। लाइव बाज़ार देखें, अपना Vault प्रबंधित करें और तैयार होने पर आगे बढ़ें।", "मुफ़्त खाता बनाएँ", "अपना Vault देखें", "निजी खाता डेटा", "प्रशासक द्वारा जाँची गई फंडिंग", "Vault का सारांश", "इस महीने 12.4%", "लाइव बाज़ार", "स्थिर मूल्य", "लाइव बाज़ार की झलक", "बाज़ार एक नज़र में।", "कीमतें अपडेट हो रही हैं…", "एक स्पष्ट Vault", "बिना ज़रूरी जानकारी खोए अपनी संपत्तियों का लाइव मूल्य और सटीक होल्डिंग देखें।", "नियंत्रित जमा", "फंडिंग अनुरोध समीक्षा और ब्लॉकचेन पुष्टि तक लंबित रहते हैं।", "खाता-स्तरीय गोपनीयता", "हर डैशबोर्ड और गतिविधि इतिहास केवल उसे बनाने वाले खाते का है।", "सोच-समझकर बनाया गया", "आपका Vault, केंद्र में।", "OnchainVault वर्तमान बाज़ार मूल्य, सटीक शेष और पारदर्शी गतिविधि इतिहास पास रखता है।", "अपना Vault शुरू करें"],
  zh: ["语言", "登录", "开始使用", "你的资产，由你掌控", "自信迎接下一步", "从容前行。", "为你的数字资产打造的贴心空间。追踪实时市场、管理 Vault，并在准备好时采取行动。", "免费创建账户", "查看你的 Vault", "账户数据私密", "管理员审核入金", "Vault 概览", "本月 12.4%", "实时市场", "稳定价值", "实时市场快照", "市场一览。", "正在更新价格…", "清晰的 Vault", "查看资产实时价值和准确持仓，不错过重要信息。", "受控入金", "入金请求需经审核并在区块链上确认后才会完成。", "账户级隐私", "每个仪表盘和活动记录仅属于创建它的账户。", "用心打造", "聚焦你的 Vault。", "OnchainVault 汇集实用信息：当前市值、准确余额和透明的活动记录。", "开启你的 Vault"],
  ja: ["言語", "ログイン", "始める", "資産も、使い方も、自分らしく", "次の一歩に備えて", "自信を持って。", "デジタル資産のための使いやすい場所。市場をリアルタイムで確認し、Vaultを管理して、準備ができたら行動できます。", "無料アカウントを作成", "Vaultを見る", "アカウント情報は非公開", "管理者が入金を確認", "Vaultの概要", "今月12.4%", "リアルタイム市場", "安定した価値", "リアルタイム市場情報", "市場をひと目で。", "価格を更新中…", "わかりやすいVault", "大切な情報を見失わずに、資産の現在価値と正確な保有額を確認できます。", "確認済みの入金", "入金リクエストは審査され、ブロックチェーンで確認されるまで保留されます。", "アカウントごとのプライバシー", "ダッシュボードと履歴は、それを作成したアカウントだけに属します。", "意図を込めて設計", "Vaultを、もっと見やすく。", "OnchainVaultは現在価値、正確な残高、透明な履歴を分かりやすく表示します。", "Vaultを始める"],
  ko: ["언어", "로그인", "시작하기", "자산도, 흐름도 내 방식대로", "다음 단계를 준비하세요", "자신 있게.", "디지털 자산을 위한 세심한 공간입니다. 실시간 시장을 확인하고 Vault를 관리하며 준비가 되면 움직이세요.", "무료 계정 만들기", "Vault 보기", "계정 데이터 비공개", "관리자가 입금을 검토", "Vault 개요", "이번 달 12.4%", "실시간 시장", "안정적인 가치", "실시간 시장 요약", "시장을 한눈에.", "가격 업데이트 중…", "명확한 Vault", "중요한 정보를 놓치지 않고 자산의 실시간 가치와 정확한 보유량을 확인하세요.", "검토되는 입금", "입금 요청은 검토 후 블록체인에서 확인될 때까지 대기 상태입니다.", "계정별 개인정보 보호", "대시보드와 활동 기록은 생성한 계정에만 속합니다.", "세심하게 만들었습니다", "Vault에 집중하세요.", "OnchainVault에서 현재 시장 가치, 정확한 잔액, 투명한 활동 내역을 확인하세요.", "Vault 시작하기"],
  ru: ["Язык", "Войти", "Начать", "Ваши активы — ваш ритм", "Будьте готовы к следующему шагу", "уверенно.", "Продуманное пространство для цифровых активов. Следите за рынками, управляйте Vault и действуйте, когда будете готовы.", "Создать бесплатный аккаунт", "Открыть Vault", "Данные аккаунта конфиденциальны", "Пополнение проверяет администратор", "Обзор Vault", "12,4% за этот месяц", "Рынок в реальном времени", "Стабильная стоимость", "Обзор рынка в реальном времени", "Рынки с первого взгляда.", "Обновление цен…", "Понятный Vault", "Следите за текущей стоимостью активов и точными остатками, не упуская важное.", "Контролируемые пополнения", "Запросы на пополнение ожидают проверки и подтверждения в блокчейне.", "Конфиденциальность аккаунта", "Панель и история операций доступны только создавшему их аккаунту.", "Продумано до мелочей", "Ваш Vault — в центре внимания.", "OnchainVault показывает главное: текущую стоимость, точные балансы и прозрачную историю.", "Начать работу с Vault"],
  id: ["Bahasa", "Masuk", "Mulai", "Asetmu, alurmu", "Siap untuk langkah berikutnya", "dengan yakin.", "Ruang yang dirancang untuk aset digitalmu. Pantau pasar langsung, kelola Vault, dan bertindak saat siap.", "Buat akun gratis", "Lihat Vault", "Data akun pribadi", "Pendanaan ditinjau admin", "Ringkasan Vault", "12,4% bulan ini", "Pasar langsung", "Nilai stabil", "Cuplikan pasar langsung", "Pasar dalam sekejap.", "Memperbarui harga…", "Vault yang jelas", "Lihat nilai aset langsung dan kepemilikan akurat tanpa kehilangan hal penting.", "Setoran terkontrol", "Permintaan pendanaan tertunda sampai ditinjau dan dikonfirmasi di blockchain.", "Privasi tingkat akun", "Setiap dasbor dan riwayat aktivitas hanya milik akun yang membuatnya.", "Dirancang dengan cermat", "Vault-mu, jadi fokus.", "OnchainVault menampilkan detail penting: nilai pasar terkini, saldo akurat, dan riwayat transparan.", "Mulai Vault-mu"],
  ro: ["Limbă", "Autentificare", "Începe", "Activele tale, în ritmul tău", "Pregătește-te pentru următorul pas", "cu încredere.", "Un spațiu creat pentru activele tale digitale. Urmărește piețele în timp real, gestionează-ți Vault-ul și acționează când ești pregătit.", "Creează un cont gratuit", "Vezi Vault-ul", "Datele contului sunt private", "Depuneri verificate de administrator", "Prezentare Vault", "12,4% luna aceasta", "Piață în timp real", "Valoare stabilă", "Rezumatul pieței în timp real", "Piețele dintr-o privire.", "Se actualizează prețurile…", "Un Vault clar", "Vezi valoarea activelor și soldurile exacte fără să pierzi din vedere ce contează.", "Depuneri controlate", "Cererile de depunere rămân în așteptare până sunt verificate și confirmate pe blockchain.", "Confidențialitate la nivel de cont", "Fiecare tablou de bord și istoric aparține doar contului care l-a creat.", "Creat cu grijă", "Vault-ul tău, în prim-plan.", "OnchainVault păstrează la îndemână detaliile practice: valoarea actuală, soldurile exacte și un istoric transparent.", "Pornește Vault-ul"],
  pl: ["Język", "Zaloguj się", "Rozpocznij", "Twoje aktywa, Twoje tempo", "Przygotuj się na kolejny krok", "z pewnością.", "Przemyślane miejsce na Twoje aktywa cyfrowe. Śledź rynki na żywo, zarządzaj Vaultem i działaj, gdy będziesz gotowy.", "Utwórz darmowe konto", "Zobacz swój Vault", "Prywatne dane konta", "Wpłaty sprawdzane przez administratora", "Przegląd Vaulta", "12,4% w tym miesiącu", "Rynek na żywo", "Stabilna wartość", "Podsumowanie rynku na żywo", "Rynki w skrócie.", "Aktualizowanie cen…", "Jeden przejrzysty Vault", "Sprawdź bieżącą wartość aktywów i dokładne stany bez utraty ważnych informacji.", "Kontrolowane wpłaty", "Prośby o wpłatę oczekują na sprawdzenie i potwierdzenie w blockchainie.", "Prywatność na poziomie konta", "Każdy panel i historia aktywności należą wyłącznie do konta, które je utworzyło.", "Stworzone z myślą o Tobie", "Twój Vault w centrum uwagi.", "OnchainVault zapewnia łatwy dostęp do najważniejszych danych: bieżącej wartości, dokładnych sald i przejrzystej historii.", "Uruchom swój Vault"],
  vi: ["Ngôn ngữ", "Đăng nhập", "Bắt đầu", "Tài sản của bạn, theo cách của bạn", "Sẵn sàng cho bước tiếp theo", "với sự tự tin.", "Không gian được thiết kế dành cho tài sản số của bạn. Theo dõi thị trường trực tiếp, quản lý Vault và hành động khi bạn sẵn sàng.", "Tạo tài khoản miễn phí", "Xem Vault của bạn", "Dữ liệu tài khoản riêng tư", "Khoản nạp được quản trị viên xem xét", "Tổng quan Vault", "12,4% trong tháng này", "Thị trường trực tiếp", "Giá trị ổn định", "Tổng quan thị trường trực tiếp", "Thị trường trong nháy mắt.", "Đang cập nhật giá…", "Vault rõ ràng", "Xem giá trị tài sản trực tiếp và số dư chính xác mà không bỏ lỡ thông tin quan trọng.", "Nạp tiền có kiểm soát", "Yêu cầu nạp tiền sẽ chờ được xem xét và xác nhận trên blockchain.", "Quyền riêng tư theo tài khoản", "Mỗi bảng điều khiển và lịch sử hoạt động chỉ thuộc về tài khoản đã tạo ra chúng.", "Được xây dựng có chủ đích", "Tập trung vào Vault của bạn.", "OnchainVault giúp bạn nắm rõ giá trị thị trường hiện tại, số dư chính xác và lịch sử minh bạch.", "Bắt đầu Vault"],
  th: ["ภาษา", "เข้าสู่ระบบ", "เริ่มต้น", "สินทรัพย์ของคุณ ในแบบของคุณ", "พร้อมสำหรับก้าวต่อไป", "อย่างมั่นใจ", "พื้นที่ที่ออกแบบมาเพื่อสินทรัพย์ดิจิทัลของคุณ ติดตามตลาดแบบเรียลไทม์ จัดการ Vault และดำเนินการเมื่อคุณพร้อม", "สร้างบัญชีฟรี", "ดู Vault ของคุณ", "ข้อมูลบัญชีเป็นส่วนตัว", "ผู้ดูแลตรวจสอบการฝากเงิน", "ภาพรวม Vault", "12.4% เดือนนี้", "ตลาดเรียลไทม์", "มูลค่าคงที่", "ภาพรวมตลาดเรียลไทม์", "ดูตลาดได้ในพริบตา", "กำลังอัปเดตราคา…", "Vault ที่ชัดเจน", "ดูมูลค่าสินทรัพย์และยอดคงเหลือที่แน่นอนได้โดยไม่พลาดข้อมูลสำคัญ", "การฝากเงินที่มีการควบคุม", "คำขอฝากเงินจะรอการตรวจสอบและยืนยันบนบล็อกเชน", "ความเป็นส่วนตัวระดับบัญชี", "แดชบอร์ดและประวัติกิจกรรมเป็นของบัญชีที่สร้างรายการนั้นเท่านั้น", "ออกแบบอย่างตั้งใจ", "โฟกัสที่ Vault ของคุณ", "OnchainVault แสดงรายละเอียดสำคัญ ทั้งมูลค่าตลาดปัจจุบัน ยอดคงเหลือที่แน่นอน และประวัติที่โปร่งใส", "เริ่มใช้ Vault"],
  bn: ["ভাষা", "সাইন ইন", "শুরু করুন", "আপনার সম্পদ, আপনার মতো করে", "পরবর্তী পদক্ষেপের জন্য প্রস্তুত", "আস্থার সঙ্গে।", "আপনার ডিজিটাল সম্পদের জন্য পরিকল্পিত একটি জায়গা। লাইভ বাজার দেখুন, Vault পরিচালনা করুন এবং প্রস্তুত হলে পদক্ষেপ নিন।", "বিনামূল্যে অ্যাকাউন্ট তৈরি করুন", "আপনার Vault দেখুন", "অ্যাকাউন্টের তথ্য ব্যক্তিগত", "অ্যাডমিন যাচাইকৃত ফান্ডিং", "Vault-এর সারাংশ", "এই মাসে ১২.৪%", "লাইভ বাজার", "স্থিতিশীল মূল্য", "লাইভ বাজারের ঝলক", "এক নজরে বাজার।", "দাম আপডেট হচ্ছে…", "একটি পরিষ্কার Vault", "গুরুত্বপূর্ণ তথ্য না হারিয়ে সম্পদের বর্তমান মূল্য ও সঠিক পরিমাণ দেখুন।", "নিয়ন্ত্রিত জমা", "পর্যালোচনা ও ব্লকচেইনে নিশ্চিত না হওয়া পর্যন্ত জমার অনুরোধ অপেক্ষায় থাকে।", "অ্যাকাউন্টভিত্তিক গোপনীয়তা", "প্রতিটি ড্যাশবোর্ড ও কার্যকলাপের ইতিহাস কেবল তৈরি করা অ্যাকাউন্টের।", "যত্ন নিয়ে তৈরি", "আপনার Vault, নজরের কেন্দ্রে।", "OnchainVault-এ বর্তমান বাজারমূল্য, সঠিক ব্যালেন্স এবং স্বচ্ছ কার্যকলাপের ইতিহাস একসঙ্গে দেখুন।", "আপনার Vault শুরু করুন"],
  ur: ["زبان", "سائن اِن", "شروع کریں", "آپ کے اثاثے، آپ کے انداز میں", "اگلے قدم کے لیے تیار", "اعتماد کے ساتھ۔", "آپ کے ڈیجیٹل اثاثوں کے لیے ایک سوچا سمجھا مقام۔ لائیو مارکیٹس دیکھیں، اپنا Vault سنبھالیں اور تیار ہونے پر قدم اٹھائیں۔", "مفت اکاؤنٹ بنائیں", "اپنا Vault دیکھیں", "اکاؤنٹ کا ڈیٹا نجی ہے", "ایڈمن کی جانچ شدہ فنڈنگ", "Vault کا جائزہ", "اس ماہ 12.4%", "لائیو مارکیٹ", "مستحکم قدر", "لائیو مارکیٹ کی جھلک", "مارکیٹس ایک نظر میں۔", "قیمتیں اپ ڈیٹ ہو رہی ہیں…", "ایک واضح Vault", "اہم باتوں سے توجہ ہٹائے بغیر اپنے اثاثوں کی موجودہ قدر اور درست ہولڈنگز دیکھیں۔", "کنٹرول شدہ ڈپازٹس", "فنڈنگ کی درخواستیں جائزے اور بلاک چین پر تصدیق تک زیر التوا رہتی ہیں۔", "اکاؤنٹ کی سطح پر رازداری", "ہر ڈیش بورڈ اور سرگرمی کی تاریخ صرف اسے بنانے والے اکاؤنٹ کی ہے۔", "سوچ سمجھ کر بنایا گیا", "آپ کا Vault، نمایاں۔", "OnchainVault موجودہ مارکیٹ ویلیو، درست بیلنس اور شفاف سرگرمی کی تفصیل سامنے رکھتا ہے۔", "اپنا Vault شروع کریں"]
};
const landingLanguages = [["en","English"],["es","Español"],["fr","Français"],["de","Deutsch"],["pt","Português"],["it","Italiano"],["nl","Nederlands"],["tr","Türkçe"],["ar","العربية"],["hi","हिन्दी"],["zh","中文"],["ja","日本語"],["ko","한국어"],["ru","Русский"],["id","Bahasa Indonesia"],["sw","Kiswahili"],["ro","Română"],["pl","Polski"],["vi","Tiếng Việt"],["th","ไทย"],["bn","বাংলা"],["ur","اردو"]];
let landingLanguage = localStorage.getItem("vf_landing_language") || "en";
const appPhraseRows = [
  ["Overview","Resumen","Vue d’ensemble","Übersicht","Visão geral","Panoramica","Overzicht","Genel Bakış","نظرة عامة","अवलोकन","概览","概要","개요","Обзор","Ringkasan","Muhtasari","Prezentare","Przegląd","Tổng quan","ภาพรวม","সারসংক্ষেপ","جائزہ"],
  ["Earn","Ganar","Gagner","Verdienen","Ganhar","Guadagna","Verdienen","Kazanç","اكسب","कमाएँ","赚取","獲得","수익","Заработок","Hasilkan","Pata","Câștigă","Zarabiaj","Kiếm tiền","รับผลตอบแทน","আয় করুন","کمائیں"],
  ["Activity","Actividad","Activité","Aktivität","Atividade","Attività","Activiteit","Etkinlik","النشاط","गतिविधि","活动","アクティビティ","활동","Активность","Aktivitas","Shughuli","Activitate","Aktywność","Hoạt động","กิจกรรม","কার্যকলাপ","سرگرمی"],
  ["Add funds","Añadir fondos","Ajouter des fonds","Geld einzahlen","Adicionar fundos","Aggiungi fondi","Geld toevoegen","Para ekle","إضافة أموال","फ़ंड जोड़ें","添加资金","資金を追加","자금 추가","Добавить средства","Tambah dana","Ongeza fedha","Adaugă fonduri","Dodaj środki","Thêm tiền","เพิ่มเงิน","তহবিল যোগ করুন","رقم شامل کریں"],
  ["Admin Console","Consola de administración","Console d’administration","Admin-Konsole","Console do administrador","Console di amministrazione","Beheerdersconsole","Yönetici Konsolu","لوحة المسؤول","व्यवस्थापक कंसोल","管理控制台","管理コンソール","관리자 콘솔","Панель администратора","Konsol Admin","Dashibodi ya msimamizi","Consolă de administrare","Konsola administratora","Bảng quản trị","คอนโซลผู้ดูแล","অ্যাডমিন কনসোল","ایڈمن کنسول"],
  ["Chat with support","Chatear con soporte","Contacter l’assistance","Support kontaktieren","Falar com o suporte","Chatta con l’assistenza","Chat met support","Destekle sohbet et","تواصل مع الدعم","सहायता से चैट करें","联系支持","サポートに問い合わせ","지원팀과 채팅","Чат с поддержкой","Hubungi dukungan","Wasiliana na usaidizi","Discută cu asistența","Czat z pomocą","Trò chuyện với hỗ trợ","แชตกับฝ่ายช่วยเหลือ","সহায়তার সঙ্গে চ্যাট","سپورٹ سے بات کریں"],
  ["Sign out","Cerrar sesión","Se déconnecter","Abmelden","Sair","Esci","Uitloggen","Çıkış yap","تسجيل الخروج","साइन आउट","退出登录","ログアウト","로그아웃","Выйти","Keluar","Ondoka","Deconectare","Wyloguj się","Đăng xuất","ออกจากระบบ","সাইন আউট","سائن آؤٹ"],
  ["Welcome back","Te damos la bienvenida","Bon retour","Willkommen zurück","Boas-vindas de volta","Bentornato","Welkom terug","Tekrar hoş geldin","مرحبًا بعودتك","वापसी पर स्वागत है","欢迎回来","おかえりなさい","다시 오신 것을 환영합니다","С возвращением","Selamat datang kembali","Karibu tena","Bine ai revenit","Witamy ponownie","Chào mừng bạn trở lại","ยินดีต้อนรับกลับ","আবারও স্বাগতম","خوش آمدید"],
  ["Create your Vault","Crea tu Vault","Créer votre Vault","Vault erstellen","Crie seu Vault","Crea il tuo Vault","Maak je Vault","Vault'unu oluştur","أنشئ خزنتك","अपना Vault बनाएँ","创建你的 Vault","Vaultを作成","Vault 만들기","Создать Vault","Buat Vault","Unda Vault yako","Creează-ți Vault-ul","Utwórz Vault","Tạo Vault của bạn","สร้าง Vault ของคุณ","আপনার Vault তৈরি করুন","اپنا Vault بنائیں"],
  ["Sign in to access your Vault.","Inicia sesión para acceder a tu Vault.","Connectez-vous pour accéder à votre Vault.","Melde dich an, um auf deinen Vault zuzugreifen.","Entre para acessar seu Vault.","Accedi per aprire il tuo Vault.","Log in om je Vault te openen.","Vault'una erişmek için giriş yap.","سجّل الدخول للوصول إلى خزنتك.","अपने Vault तक पहुँचने के लिए साइन इन करें।","登录以访问你的 Vault。","Vaultにアクセスするにはログインしてください。","Vault에 접속하려면 로그인하세요.","Войдите, чтобы открыть Vault.","Masuk untuk mengakses Vault.","Ingia ili kufikia Vault yako.","Autentifică-te pentru a-ți accesa Vault-ul.","Zaloguj się, aby otworzyć Vault.","Đăng nhập để truy cập Vault.","เข้าสู่ระบบเพื่อเข้าถึง Vault","সাইন ইন করে Vault-এ প্রবেশ করুন।","اپنے Vault تک رسائی کے لیے سائن اِن کریں۔"],
  ["Total Vault value","Valor total del Vault","Valeur totale du Vault","Vault-Gesamtwert","Valor total do Vault","Valore totale del Vault","Totale Vault-waarde","Toplam Vault değeri","إجمالي قيمة الخزنة","Vault का कुल मूल्य","Vault 总价值","Vaultの合計価値","Vault 총 가치","Общая стоимость Vault","Total nilai Vault","Jumla ya thamani ya Vault","Valoarea totală a Vault-ului","Łączna wartość Vaulta","Tổng giá trị Vault","มูลค่า Vault ทั้งหมด","Vault-এর মোট মূল্য","Vault کی کل مالیت"],
  ["Your assets","Tus activos","Vos actifs","Deine Assets","Seus ativos","I tuoi asset","Je assets","Varlıkların","أصولك","आपकी संपत्तियाँ","你的资产","あなたの資産","내 자산","Ваши активы","Aset Anda","Rasilimali zako","Activele tale","Twoje aktywa","Tài sản của bạn","สินทรัพย์ของคุณ","আপনার সম্পদ","آپ کے اثاثے"],
  ["Recent activity","Actividad reciente","Activité récente","Letzte Aktivitäten","Atividade recente","Attività recenti","Recente activiteit","Son etkinlikler","النشاط الأخير","हाल की गतिविधि","近期活动","最近のアクティビティ","최근 활동","Последние операции","Aktivitas terbaru","Shughuli za hivi karibuni","Activitate recentă","Ostatnia aktywność","Hoạt động gần đây","กิจกรรมล่าสุด","সাম্প্রতিক কার্যকলাপ","حالیہ سرگرمیاں"],
  ["View all activity","Ver toda la actividad","Voir toute l’activité","Alle Aktivitäten anzeigen","Ver toda a atividade","Vedi tutte le attività","Alle activiteit bekijken","Tüm etkinlikleri gör","عرض كل النشاط","सभी गतिविधि देखें","查看全部活动","すべての履歴を見る","모든 활동 보기","Вся активность","Lihat semua aktivitas","Tazama shughuli zote","Vezi toată activitatea","Zobacz całą aktywność","Xem tất cả hoạt động","ดูกิจกรรมทั้งหมด","সব কার্যকলাপ দেখুন","تمام سرگرمیاں دیکھیں"],
  ["Account activity","Actividad de la cuenta","Activité du compte","Kontoaktivität","Atividade da conta","Attività dell’account","Accountactiviteit","Hesap etkinliği","نشاط الحساب","खाता गतिविधि","账户活动","アカウントのアクティビティ","계정 활동","Активность аккаунта","Aktivitas akun","Shughuli za akaunti","Activitatea contului","Aktywność konta","Hoạt động tài khoản","กิจกรรมบัญชี","অ্যাকাউন্টের কার্যকলাপ","اکاؤنٹ کی سرگرمی"],
  ["Transaction history","Historial de transacciones","Historique des transactions","Transaktionsverlauf","Histórico de transações","Cronologia delle transazioni","Transactiegeschiedenis","İşlem geçmişi","سجل المعاملات","लेन-देन इतिहास","交易记录","取引履歴","거래 내역","История транзакций","Riwayat transaksi","Historia ya miamala","Istoricul tranzacțiilor","Historia transakcji","Lịch sử giao dịch","ประวัติธุรกรรม","লেনদেনের ইতিহাস","لین دین کی سرگزشت"],
  ["Receive assets","Recibir activos","Recevoir des actifs","Assets empfangen","Receber ativos","Ricevi asset","Assets ontvangen","Varlık al","استلام الأصول","संपत्तियाँ प्राप्त करें","接收资产","資産を受け取る","자산 받기","Получить активы","Terima aset","Pokea rasilimali","Primește active","Odbierz aktywa","Nhận tài sản","รับสินทรัพย์","সম্পদ গ্রহণ","اثاثے وصول کریں"],
  ["Send assets","Enviar activos","Envoyer des actifs","Assets senden","Enviar ativos","Invia asset","Assets versturen","Varlık gönder","إرسال الأصول","संपत्तियाँ भेजें","发送资产","資産を送る","자산 보내기","Отправить активы","Kirim aset","Tuma rasilimali","Trimite active","Wyślij aktywa","Gửi tài sản","ส่งสินทรัพย์","সম্পদ পাঠান","اثاثے بھیجیں"],
  ["Swap assets","Intercambiar activos","Échanger des actifs","Assets tauschen","Trocar ativos","Scambia asset","Assets wisselen","Varlıkları takas et","مبادلة الأصول","संपत्तियाँ बदलें","兑换资产","資産を交換","자산 교환","Обменять активы","Tukar aset","Badilisha rasilimali","Schimbă active","Wymień aktywa","Hoán đổi tài sản","แลกเปลี่ยนสินทรัพย์","সম্পদ অদলবদল","اثاثوں کا تبادلہ"],
  ["Confirm","Confirmar","Confirmer","Bestätigen","Confirmar","Conferma","Bevestigen","Onayla","تأكيد","पुष्टि करें","确认","確認","확인","Подтвердить","Konfirmasi","Thibitisha","Confirmă","Potwierdź","Xác nhận","ยืนยัน","নিশ্চিত করুন","تصدیق کریں"],
  ["Cancel","Cancelar","Annuler","Abbrechen","Cancelar","Annulla","Annuleren","İptal","إلغاء","रद्द करें","取消","キャンセル","취소","Отмена","Batal","Ghairi","Anulează","Anuluj","Hủy","ยกเลิก","বাতিল","منسوخ کریں"],
  ["Try again","Intentar de nuevo","Réessayer","Erneut versuchen","Tentar novamente","Riprova","Opnieuw proberen","Tekrar dene","حاول مرة أخرى","फिर कोशिश करें","重试","もう一度試す","다시 시도","Повторить","Coba lagi","Jaribu tena","Încearcă din nou","Spróbuj ponownie","Thử lại","ลองอีกครั้ง","আবার চেষ্টা করুন","دوبارہ کوشش کریں"],
  ["Here’s how your Vault is doing today.","Así va tu Vault hoy.","Voici l’état de votre Vault aujourd’hui.","So steht es heute um deinen Vault.","Veja como está seu Vault hoje.","Ecco come sta andando il tuo Vault oggi.","Zo gaat het vandaag met je Vault.","Vault'un bugün böyle görünüyor.","إليك حالة خزنتك اليوم.","आज आपका Vault कैसा है, यह देखें।","查看你的 Vault 今日状态。","今日のVaultの状況です。","오늘 Vault 현황을 확인하세요.","Состояние вашего Vault на сегодня.","Berikut kondisi Vault Anda hari ini.","Hivi ndivyo Vault yako ilivyo leo.","Iată situația Vault-ului tău de azi.","Oto stan Twojego Vaulta.","Đây là tình hình Vault hôm nay.","สถานะ Vault ของคุณวันนี้","আজ আপনার Vault-এর অবস্থা দেখুন।","آج آپ کے Vault کی صورتحال یہ ہے۔"],
  ["Loading live market prices…","Cargando precios del mercado…","Chargement des cours en direct…","Live-Marktpreise werden geladen…","Carregando preços do mercado…","Caricamento prezzi di mercato…","Live marktprijzen laden…","Canlı piyasa fiyatları yükleniyor…","جارٍ تحميل أسعار السوق…","लाइव बाज़ार कीमतें लोड हो रही हैं…","正在加载实时市场价格…","リアルタイム価格を読み込み中…","실시간 시장 가격을 불러오는 중…","Загрузка рыночных цен…","Memuat harga pasar…","Inapakia bei za soko…","Se încarcă prețurile pieței…","Wczytywanie cen rynkowych…","Đang tải giá thị trường…","กำลังโหลดราคาตลาด…","লাইভ বাজারদর লোড হচ্ছে…","لائیو مارکیٹ قیمتیں لوڈ ہو رہی ہیں…"],
  ["Your activity will appear here.","Tu actividad aparecerá aquí.","Votre activité apparaîtra ici.","Deine Aktivitäten werden hier angezeigt.","Sua atividade aparecerá aqui.","Le tue attività appariranno qui.","Je activiteit verschijnt hier.","Etkinliğin burada görünecek.","سيظهر نشاطك هنا.","आपकी गतिविधि यहाँ दिखाई देगी।","你的活动会显示在这里。","ここにアクティビティが表示されます。","여기에 활동 내역이 표시됩니다.","Здесь будет отображаться ваша активность.","Aktivitas Anda akan muncul di sini.","Shughuli zako zitaonekana hapa.","Activitatea ta va apărea aici.","Twoja aktywność pojawi się tutaj.","Hoạt động của bạn sẽ hiển thị tại đây.","กิจกรรมของคุณจะแสดงที่นี่","আপনার কার্যকলাপ এখানে দেখা যাবে।","آپ کی سرگرمیاں یہاں ظاہر ہوں گی۔"],
  ["No activity yet. Add funds to begin building your Vault.","Aún no hay actividad. Añade fondos para empezar a crear tu Vault.","Aucune activité. Ajoutez des fonds pour commencer à constituer votre Vault.","Noch keine Aktivitäten. Zahle Geld ein, um deinen Vault aufzubauen.","Nenhuma atividade. Adicione fundos para começar a construir seu Vault.","Nessuna attività. Aggiungi fondi per iniziare a creare il tuo Vault.","Nog geen activiteit. Voeg geld toe om je Vault op te bouwen.","Henüz etkinlik yok. Vault'unu oluşturmaya başlamak için para ekle.","لا يوجد نشاط بعد. أضف أموالًا لبدء إنشاء خزنتك.","अभी कोई गतिविधि नहीं। अपना Vault बनाने के लिए फ़ंड जोड़ें।","暂无活动。添加资金以开始建立 Vault。","まだ履歴がありません。資金を追加してVaultを作成しましょう。","아직 활동이 없습니다. Vault를 만들려면 자금을 추가하세요.","Активности пока нет. Пополните счёт, чтобы начать создавать Vault.","Belum ada aktivitas. Tambahkan dana untuk mulai membangun Vault.","Hakuna shughuli bado. Ongeza fedha ili kuanza kujenga Vault yako.","Nicio activitate încă. Adaugă fonduri pentru a-ți construi Vault-ul.","Brak aktywności. Dodaj środki, aby zacząć budować Vault.","Chưa có hoạt động. Hãy thêm tiền để bắt đầu xây dựng Vault.","ยังไม่มีกิจกรรม เพิ่มเงินเพื่อเริ่มสร้าง Vault","এখনও কোনো কার্যকলাপ নেই। Vault তৈরি শুরু করতে তহবিল যোগ করুন।","ابھی کوئی سرگرمی نہیں۔ اپنا Vault بنانا شروع کرنے کے لیے رقم شامل کریں۔"],
  ["How can we help?","¿Cómo podemos ayudarte?","Comment pouvons-nous vous aider ?","Wie können wir helfen?","Como podemos ajudar?","Come possiamo aiutarti?","Waarmee kunnen we je helpen?","Size nasıl yardımcı olabiliriz?","كيف يمكننا مساعدتك؟","हम आपकी कैसे मदद कर सकते हैं?","我们能为你提供什么帮助？","お困りですか？","무엇을 도와드릴까요?","Чем мы можем помочь?","Ada yang bisa kami bantu?","Tunawezaje kukusaidia?","Cu ce te putem ajuta?","W czym możemy pomóc?","Chúng tôi có thể giúp gì cho bạn?","เราช่วยอะไรคุณได้บ้าง","আমরা কীভাবে সাহায্য করতে পারি?","ہم آپ کی کیا مدد کر سکتے ہیں؟"],
  ["Send a message to start a private conversation with OnchainVault support.","Envía un mensaje para iniciar una conversación privada con el soporte de OnchainVault.","Envoyez un message pour démarrer une conversation privée avec l’assistance OnchainVault.","Sende eine Nachricht, um einen privaten Chat mit dem OnchainVault-Support zu beginnen.","Envie uma mensagem para iniciar uma conversa privada com o suporte da OnchainVault.","Invia un messaggio per avviare una conversazione privata con l’assistenza OnchainVault.","Stuur een bericht om een privégesprek met OnchainVault-ondersteuning te starten.","OnchainVault desteğiyle özel bir görüşme başlatmak için mesaj gönder.","أرسل رسالة لبدء محادثة خاصة مع دعم OnchainVault.","OnchainVault सहायता के साथ निजी बातचीत शुरू करने के लिए संदेश भेजें।","发送消息即可开始与 OnchainVault 支持团队的私密对话。","メッセージを送信してOnchainVaultサポートとの非公開チャットを開始してください。","메시지를 보내 OnchainVault 지원팀과 비공개 대화를 시작하세요.","Отправьте сообщение, чтобы начать личный разговор со службой поддержки OnchainVault.","Kirim pesan untuk memulai percakapan pribadi dengan dukungan OnchainVault.","Tuma ujumbe ili kuanza mazungumzo ya faragha na usaidizi wa OnchainVault.","Trimite un mesaj pentru a începe o conversație privată cu echipa de asistență OnchainVault.","Wyślij wiadomość, aby rozpocząć prywatną rozmowę z pomocą OnchainVault.","Gửi tin nhắn để bắt đầu trò chuyện riêng với bộ phận hỗ trợ OnchainVault.","ส่งข้อความเพื่อเริ่มแชตส่วนตัวกับฝ่ายช่วยเหลือ OnchainVault","OnchainVault সহায়তা দলের সঙ্গে ব্যক্তিগত কথোপকথন শুরু করতে বার্তা পাঠান।","OnchainVault سپورٹ کے ساتھ نجی گفتگو شروع کرنے کے لیے پیغام بھیجیں۔"],
  ["Send message","Enviar mensaje","Envoyer un message","Nachricht senden","Enviar mensagem","Invia messaggio","Bericht sturen","Mesaj gönder","إرسال رسالة","संदेश भेजें","发送消息","メッセージを送信","메시지 보내기","Отправить сообщение","Kirim pesan","Tuma ujumbe","Trimite mesaj","Wyślij wiadomość","Gửi tin nhắn","ส่งข้อความ","বার্তা পাঠান","پیغام بھیجیں"],
  ["Available to stake","Disponible para hacer staking","Disponible au staking","Zum Staking verfügbar","Disponível para staking","Disponibile per lo staking","Beschikbaar om te staken","Stake için uygun","متاح للتخزين","स्टेक करने के लिए उपलब्ध","可用于质押","ステーキング可能","스테이킹 가능","Доступно для стейкинга","Tersedia untuk staking","Inaweza kuwekwa kwenye staking","Disponibil pentru staking","Dostępne do stakingu","Có thể staking","พร้อม Stake","স্টেক করার জন্য উপলব্ধ","اسٹیک کے لیے دستیاب"],
  ["Available balance","Saldo disponible","Solde disponible","Verfügbares Guthaben","Saldo disponível","Saldo disponibile","Beschikbaar saldo","Kullanılabilir bakiye","الرصيد المتاح","उपलब्ध शेष राशि","可用余额","利用可能残高","사용 가능 잔액","Доступный баланс","Saldo tersedia","Salio linalopatikana","Sold disponibil","Dostępne saldo","Số dư khả dụng","ยอดคงเหลือที่ใช้ได้","উপলভ্য ব্যালেন্স","دستیاب بیلنس"],
  ["Pending","Pendiente","En attente","Ausstehend","Pendente","In sospeso","In behandeling","Bekliyor","معلق","लंबित","待处理","保留中","대기 중","В ожидании","Tertunda","Inasubiri","În așteptare","Oczekuje","Đang chờ","รอดำเนินการ","অপেক্ষমাণ","زیر التوا"],
  ["Verified","Verificado","Vérifié","Verifiziert","Verificado","Verificato","Geverifieerd","Doğrulandı","تم التحقق","सत्यापित","已验证","認証済み","인증됨","Подтверждено","Terverifikasi","Imethibitishwa","Verificat","Zweryfikowano","Đã xác minh","ยืนยันแล้ว","যাচাইকৃত","تصدیق شدہ"],
  ["Copied","Copiado","Copié","Kopiert","Copiado","Copiato","Gekopieerd","Kopyalandı","تم النسخ","कॉपी किया गया","已复制","コピーしました","복사됨","Скопировано","Disalin","Imenakiliwa","Copiat","Skopiowano","Đã sao chép","คัดลอกแล้ว","কপি করা হয়েছে","کاپی ہو گیا"],
  ["Sign in","Iniciar sesión","Se connecter","Anmelden","Entrar","Accedi","Inloggen","Giriş yap","تسجيل الدخول","साइन इन","登录","ログイン","로그인","Войти","Masuk","Ingia","Autentificare","Zaloguj się","Đăng nhập","เข้าสู่ระบบ","সাইন ইন","سائن اِن"],
  ["Create account","Crear cuenta","Créer un compte","Konto erstellen","Criar conta","Crea account","Account maken","Hesap oluştur","إنشاء حساب","खाता बनाएँ","创建账户","アカウントを作成","계정 만들기","Создать аккаунт","Buat akun","Fungua akaunti","Creează cont","Utwórz konto","Tạo tài khoản","สร้างบัญชี","অ্যাকাউন্ট তৈরি করুন","اکاؤنٹ بنائیں"],
  ["Full name","Nombre completo","Nom complet","Vollständiger Name","Nome completo","Nome completo","Volledige naam","Ad soyad","الاسم الكامل","पूरा नाम","全名","氏名","전체 이름","Полное имя","Nama lengkap","Jina kamili","Nume complet","Imię i nazwisko","Họ và tên","ชื่อเต็ม","পূর্ণ নাম","پورا نام"],
  ["Email address","Correo electrónico","Adresse e-mail","E-Mail-Adresse","Endereço de e-mail","Indirizzo email","E-mailadres","E-posta adresi","عنوان البريد الإلكتروني","ईमेल पता","电子邮箱","メールアドレス","이메일 주소","Электронная почта","Alamat email","Anwani ya barua pepe","Adresă de e-mail","Adres e-mail","Địa chỉ email","อีเมล","ইমেল ঠিকানা","ای میل پتہ"],
  ["Password","Contraseña","Mot de passe","Passwort","Senha","Password","Wachtwoord","Şifre","كلمة المرور","पासवर्ड","密码","パスワード","비밀번호","Пароль","Kata sandi","Nenosiri","Parolă","Hasło","Mật khẩu","รหัสผ่าน","পাসওয়ার্ড","پاس ورڈ"],
  ["Confirm password","Confirmar contraseña","Confirmer le mot de passe","Passwort bestätigen","Confirmar senha","Conferma password","Bevestig wachtwoord","Şifreyi doğrula","تأكيد كلمة المرور","पासवर्ड की पुष्टि करें","确认密码","パスワードを確認","비밀번호 확인","Подтвердите пароль","Konfirmasi kata sandi","Thibitisha nenosiri","Confirmă parola","Potwierdź hasło","Xác nhận mật khẩu","ยืนยันรหัสผ่าน","পাসওয়ার্ড নিশ্চিত করুন","پاس ورڈ کی تصدیق کریں"],
  ["Create an account","Crear una cuenta","Créer un compte","Konto erstellen","Criar uma conta","Crea un account","Account aanmaken","Hesap oluştur","إنشاء حساب","खाता बनाएँ","创建账户","アカウントを作成","계정 만들기","Создать аккаунт","Buat akun","Fungua akaunti","Creează un cont","Utwórz konto","Tạo tài khoản","สร้างบัญชี","অ্যাকাউন্ট তৈরি করুন","اکاؤنٹ بنائیں"],
  ["Already have an account?","¿Ya tienes una cuenta?","Vous avez déjà un compte ?","Du hast bereits ein Konto?","Já tem uma conta?","Hai già un account?","Heb je al een account?","Zaten hesabın var mı?","هل لديك حساب بالفعل؟","क्या आपके पास पहले से खाता है?","已有账户？","すでにアカウントをお持ちですか？","이미 계정이 있으신가요?","Уже есть аккаунт?","Sudah punya akun?","Tayari una akaunti?","Ai deja un cont?","Masz już konto?","Bạn đã có tài khoản?","มีบัญชีอยู่แล้วหรือไม่","ইতিমধ্যে অ্যাকাউন্ট আছে?","کیا آپ کا اکاؤنٹ پہلے سے ہے؟"],
  ["New to OnchainVault?","¿Nuevo en OnchainVault?","Nouveau sur OnchainVault ?","Neu bei OnchainVault?","Novo no OnchainVault?","È la prima volta su OnchainVault?","Nieuw bij OnchainVault?","OnchainVault'ta yeni misin?","مستخدم جديد في OnchainVault؟","OnchainVault पर नए हैं?","刚开始使用 OnchainVault？","OnchainVaultを初めてご利用ですか？","OnchainVault가 처음이신가요?","Впервые в OnchainVault?","Baru di OnchainVault?","Mgeni kwenye OnchainVault?","Nou pe OnchainVault?","Nowy w OnchainVault?","Bạn mới dùng OnchainVault?","เพิ่งใช้ OnchainVault หรือไม่","OnchainVault-এ নতুন?","OnchainVault پر نئے ہیں؟"],
  ["Preparing your dashboard...","Preparando tu panel...","Préparation de votre tableau de bord…","Dein Dashboard wird vorbereitet…","Preparando seu painel...","Preparazione della dashboard...","Je dashboard wordt voorbereid...","Panelin hazırlanıyor...","جارٍ إعداد لوحة التحكم...","आपका डैशबोर्ड तैयार हो रहा है...","正在准备你的控制面板…","ダッシュボードを準備しています…","대시보드를 준비하는 중...","Подготовка панели управления...","Menyiapkan dasbor Anda...","Inatayarisha dashibodi yako...","Se pregătește tabloul de bord...","Przygotowywanie panelu...","Đang chuẩn bị bảng điều khiển...","กำลังเตรียมแดชบอร์ด...","আপনার ড্যাশবোর্ড প্রস্তুত হচ্ছে...","آپ کا ڈیش بورڈ تیار ہو رہا ہے..."],
  ["Good morning","Buenos días","Bonjour","Guten Morgen","Bom dia","Buongiorno","Goedemorgen","Günaydın","صباح الخير","सुप्रभात","早上好","おはようございます","좋은 아침입니다","Доброе утро","Selamat pagi","Habari za asubuhi","Bună dimineața","Dzień dobry","Chào buổi sáng","สวัสดีตอนเช้า","সুপ্রভাত","صبح بخیر"],
  ["Good afternoon","Buenas tardes","Bon après-midi","Guten Tag","Boa tarde","Buon pomeriggio","Goedemiddag","Tünaydın","مساء الخير","शुभ दोपहर","下午好","こんにちは","좋은 오후입니다","Добрый день","Selamat siang","Habari za mchana","Bună ziua","Dzień dobry","Chào buổi chiều","สวัสดีตอนบ่าย","শুভ অপরাহ্ণ","دوپہر بخیر"],
  ["Good evening","Buenas noches","Bonsoir","Guten Abend","Boa noite","Buonasera","Goedenavond","İyi akşamlar","مساء الخير","शुभ संध्या","晚上好","こんばんは","좋은 저녁입니다","Добрый вечер","Selamat malam","Habari za jioni","Bună seara","Dobry wieczór","Chào buổi tối","สวัสดีตอนเย็น","শুভ সন্ধ্যা","شام بخیر"],
  ["Your name","Tu nombre","Votre nom","Dein Name","Seu nome","Il tuo nome","Je naam","Adın","اسمك","आपका नाम","你的姓名","お名前","이름","Ваше имя","Nama Anda","Jina lako","Numele tău","Twoje imię","Tên của bạn","ชื่อของคุณ","আপনার নাম","آپ کا نام"],
  ["At least 8 characters","Al menos 8 caracteres","Au moins 8 caractères","Mindestens 8 Zeichen","Pelo menos 8 caracteres","Almeno 8 caratteri","Minimaal 8 tekens","En az 8 karakter","8 أحرف على الأقل","कम से कम 8 अक्षर","至少 8 个字符","8文字以上","8자 이상","Не менее 8 символов","Minimal 8 karakter","Angalau herufi 8","Cel puțin 8 caractere","Co najmniej 8 znaków","Ít nhất 8 ký tự","อย่างน้อย 8 ตัวอักษร","কমপক্ষে ৮টি অক্ষর","کم از کم 8 حروف"],
  ["Type your password again","Vuelve a escribir tu contraseña","Saisissez à nouveau votre mot de passe","Gib dein Passwort erneut ein","Digite sua senha novamente","Digita di nuovo la password","Typ je wachtwoord opnieuw","Şifreni tekrar yaz","اكتب كلمة المرور مرة أخرى","अपना पासवर्ड फिर से लिखें","再次输入密码","パスワードをもう一度入力","비밀번호를 다시 입력하세요","Введите пароль ещё раз","Ketik ulang kata sandi","Andika nenosiri lako tena","Introdu parola din nou","Wpisz ponownie hasło","Nhập lại mật khẩu","พิมพ์รหัสผ่านอีกครั้ง","আবার পাসওয়ার্ড লিখুন","اپنا پاس ورڈ دوبارہ لکھیں"],
  ["Flexible staking","Staking flexible","Staking flexible","Flexibles Staking","Staking flexível","Staking flessibile","Flexibel staken","Esnek stake","تخزين مرن","लचीला स्टेकिंग","灵活质押","柔軟なステーキング","유연한 스테이킹","Гибкий стейкинг","Staking fleksibel","Staking inayoweza kubadilika","Staking flexibil","Elastyczny staking","Staking linh hoạt","Stake แบบยืดหยุ่น","নমনীয় স্টেকিং","لچکدار اسٹیکنگ"],
  ["Stake crypto","Haz staking de criptomonedas","Staker des cryptos","Krypto staken","Faça staking de cripto","Fai staking di crypto","Crypto staken","Kripto stake et","قم بتخزين العملات الرقمية","क्रिप्टो स्टेक करें","质押加密货币","暗号資産をステーキング","암호화폐 스테이킹","Стейкинг криптовалюты","Stake kripto","Weka crypto kwenye staking","Fă staking cu crypto","Stakuj kryptowaluty","Stake tiền mã hóa","Stake คริปโท","ক্রিপ্টো স্টেক করুন","کرپٹو اسٹیک کریں"],
  ["Puzzle rewards","Recompensas de rompecabezas","Récompenses de puzzle","Puzzle-Belohnungen","Recompensas de quebra-cabeça","Ricompense puzzle","Puzzelbeloningen","Bulmaca ödülleri","مكافآت الألغاز","पहेली पुरस्कार","拼图奖励","パズル報酬","퍼즐 보상","Награды за головоломки","Hadiah puzzle","Zawadi za fumbo","Recompense puzzle","Nagrody za łamigłówki","Phần thưởng giải đố","รางวัลเกมปริศนา","ধাঁধার পুরস্কার","پہیلی کے انعامات"],
  ["Crypto match","Parejas cripto","Association crypto","Krypto-Paare","Combinação cripto","Abbinamento crypto","Crypto-match","Kripto eşleştirme","مطابقة العملات الرقمية","क्रिप्टो मिलान","加密配对","暗号資産マッチ","암호화폐 맞추기","Крипто-пары","Cocokkan kripto","Linganisha crypto","Potrivire crypto","Dopasuj kryptowaluty","Ghép tiền mã hóa","จับคู่คริปโท","ক্রিপ্টো মিল","کرپٹو میچ"],
  ["Private support chat","Chat privado con soporte","Chat privé avec l’assistance","Privater Support-Chat","Chat privado com suporte","Chat privato con l’assistenza","Privéchat met support","Özel destek sohbeti","محادثة دعم خاصة","निजी सहायता चैट","私密支持聊天","非公開サポートチャット","비공개 지원 채팅","Личный чат поддержки","Chat dukungan pribadi","Gumzo la faragha la usaidizi","Chat privat cu asistența","Prywatny czat pomocy","Trò chuyện hỗ trợ riêng tư","แชตส่วนตัวกับฝ่ายช่วยเหลือ","ব্যক্তিগত সহায়তা চ্যাট","نجی سپورٹ چیٹ"],
  ["Start staking","Comenzar staking","Commencer le staking","Staking starten","Começar staking","Avvia staking","Begin met staken","Stake etmeye başla","ابدأ التخزين","स्टेकिंग शुरू करें","开始质押","ステーキングを開始","스테이킹 시작","Начать стейкинг","Mulai staking","Anza staking","Începe stakingul","Rozpocznij staking","Bắt đầu staking","เริ่ม Stake","স্টেকিং শুরু করুন","اسٹیکنگ شروع کریں"],
  ["Unstake","Retirar staking","Retirer du staking","Staking beenden","Resgatar staking","Rimuovi dallo staking","Unstaken","Stake'ten çıkar","إلغاء التخزين","स्टेकिंग से निकालें","解除质押","ステーキング解除","스테이킹 해제","Вывести из стейкинга","Tarik staking","Ondoa kwenye staking","Retrage din staking","Zakończ staking","Hủy staking","ถอน Stake","স্টেকিং প্রত্যাহার","اسٹیک سے نکالیں"],
  ["Monthly reward","Recompensa mensual","Récompense mensuelle","Monatliche Belohnung","Recompensa mensal","Ricompensa mensile","Maandelijkse beloning","Aylık ödül","المكافأة الشهرية","मासिक पुरस्कार","每月奖励","月間報酬","월간 보상","Ежемесячное вознаграждение","Imbalan bulanan","Zawadi ya kila mwezi","Recompensă lunară","Nagroda miesięczna","Phần thưởng hàng tháng","รางวัลรายเดือน","মাসিক পুরস্কার","ماہانہ انعام"],
  ["Next reward","Próxima recompensa","Prochaine récompense","Nächste Belohnung","Próxima recompensa","Prossima ricompensa","Volgende beloning","Sonraki ödül","المكافأة التالية","अगला पुरस्कार","下次奖励","次回の報酬","다음 보상","Следующее вознаграждение","Imbalan berikutnya","Zawadi inayofuata","Următoarea recompensă","Następna nagroda","Phần thưởng tiếp theo","รางวัลถัดไป","পরবর্তী পুরস্কার","اگلا انعام"],
  ["Your holdings","Tus posiciones","Vos avoirs","Deine Bestände","Seus ativos","I tuoi saldi","Je bezit","Varlıkların","ممتلكاتك","आपकी होल्डिंग्स","你的持仓","保有資産","보유 자산","Ваши активы","Aset Anda","Mali zako","Deținerile tale","Twoje zasoby","Tài sản đang nắm giữ","สินทรัพย์ที่ถืออยู่","আপনার হোল্ডিংস","آپ کے اثاثے"],
  ["Current value","Valor actual","Valeur actuelle","Aktueller Wert","Valor atual","Valore attuale","Huidige waarde","Güncel değer","القيمة الحالية","वर्तमान मूल्य","当前价值","現在価値","현재 가치","Текущая стоимость","Nilai saat ini","Thamani ya sasa","Valoare curentă","Bieżąca wartość","Giá trị hiện tại","มูลค่าปัจจุบัน","বর্তমান মূল্য","موجودہ قدر"],
  ["Earn opportunities","Oportunidades para ganar","Opportunités de rendement","Verdienstmöglichkeiten","Oportunidades de rendimento","Opportunità di guadagno","Verdienmogelijkheden","Kazanç fırsatları","فرص الربح","कमाई के अवसर","赚取收益的机会","収益の機会","수익 기회","Возможности заработка","Peluang mendapatkan imbalan","Fursa za kupata mapato","Oportunități de câștig","Możliwości zarabiania","Cơ hội sinh lời","โอกาสรับผลตอบแทน","আয়ের সুযোগ","آمدنی کے مواقع"],
  ["Make more of your assets.","Sácale más partido a tus activos.","Tirez le meilleur parti de vos actifs.","Mach mehr aus deinen Assets.","Aproveite melhor seus ativos.","Ottieni di più dai tuoi asset.","Haal meer uit je assets.","Varlıklarından daha fazlasını elde et.","حقق استفادة أكبر من أصولك.","अपनी संपत्तियों से अधिक लाभ पाएँ।","让你的资产发挥更大价值。","資産をもっと活用しましょう。","자산을 더 가치 있게 활용하세요.","Получайте больше от своих активов.","Maksimalkan aset Anda.","Pata manufaa zaidi kutoka kwa rasilimali zako.","Valorifică mai bine activele.","Wykorzystaj lepiej swoje aktywa.","Tận dụng tài sản hiệu quả hơn.","ใช้สินทรัพย์ของคุณให้คุ้มค่ายิ่งขึ้น","আপনার সম্পদ থেকে আরও সুবিধা নিন।","اپنے اثاثوں سے زیادہ فائدہ اٹھائیں۔"],
  ["Current staked value","Valor actual en staking","Valeur actuellement mise en staking","Aktuell gestakter Wert","Valor atualmente em staking","Valore attualmente in staking","Huidige stakingwaarde","Mevcut stake değeri","القيمة الحالية للأصول المودعة","वर्तमान स्टेक मूल्य","当前质押价值","現在のステーキング額","현재 스테이킹 가치","Текущая сумма в стейкинге","Nilai staking saat ini","Thamani iliyowekwa kwenye staking","Valoare curentă în staking","Obecna wartość stakingu","Giá trị đang staking","มูลค่าที่ Stake อยู่","বর্তমানে স্টেক করা মূল্য","اسٹیک کی موجودہ مالیت"],
  ["Active staking","Staking activo","Staking actif","Aktives Staking","Staking ativo","Staking attivo","Actieve staking","Aktif stake","التخزين النشط","सक्रिय स्टेकिंग","进行中的质押","実行中のステーキング","활성 스테이킹","Активный стейкинг","Staking aktif","Staking inayotumika","Staking activ","Aktywny staking","Đang staking","กำลัง Stake","সক্রিয় স্টেকিং","فعال اسٹیکنگ"],
  ["Start puzzle","Iniciar rompecabezas","Commencer le puzzle","Puzzle starten","Começar quebra-cabeça","Avvia puzzle","Puzzel starten","Bulmacayı başlat","ابدأ اللغز","पहेली शुरू करें","开始拼图","パズルを開始","퍼즐 시작","Начать головоломку","Mulai puzzle","Anza fumbo","Începe puzzle-ul","Rozpocznij łamigłówkę","Bắt đầu giải đố","เริ่มเกมปริศนา","ধাঁধা শুরু করুন","پہیلی شروع کریں"],
  ["Resume round","Reanudar ronda","Reprendre la manche","Runde fortsetzen","Retomar rodada","Riprendi round","Ronde hervatten","Tura devam et","استأنف الجولة","राउंड फिर शुरू करें","继续本轮","ラウンドを再開","라운드 재개","Продолжить раунд","Lanjutkan ronde","Endelea na raundi","Reia runda","Wznów rundę","Tiếp tục vòng","เล่นรอบต่อ","রাউন্ড আবার শুরু করুন","راؤنڈ دوبارہ شروع کریں"],
  ["Quit round","Abandonar ronda","Quitter la manche","Runde beenden","Sair da rodada","Abbandona round","Ronde stoppen","Turu bitir","إنهاء الجولة","राउंड छोड़ें","退出本轮","ラウンドを終了","라운드 종료","Выйти из раунда","Keluar dari ronde","Acha raundi","Renunță la rundă","Zakończ rundę","Thoát vòng","ออกจากรอบ","রাউন্ড ছেড়ে দিন","راؤنڈ چھوڑیں"],
  ["Chat with support","Chatear con soporte","Contacter l’assistance","Support kontaktieren","Falar com o suporte","Chatta con l’assistenza","Chat met support","Destekle sohbet et","تواصل مع الدعم","सहायता से चैट करें","联系支持","サポートに問い合わせ","지원팀과 채팅","Чат с поддержкой","Hubungi dukungan","Wasiliana na usaidizi","Discută cu asistența","Czat z pomocą","Trò chuyện với hỗ trợ","แชตกับฝ่ายช่วยเหลือ","সহায়তার সঙ্গে চ্যাট","سپورٹ سے بات کریں"],
  ["Private support chat","Chat privado con soporte","Chat privé avec l’assistance","Privater Support-Chat","Chat privado com suporte","Chat privato con l’assistenza","Privéchat met support","Özel destek sohbeti","محادثة دعم خاصة","निजी सहायता चैट","私密支持聊天","非公開サポートチャット","비공개 지원 채팅","Личный чат поддержки","Chat dukungan pribadi","Gumzo la faragha la usaidizi","Chat privat cu asistența","Prywatny czat pomocy","Trò chuyện hỗ trợ riêng tư","แชตส่วนตัวกับฝ่ายช่วยเหลือ","ব্যক্তিগত সহায়তা চ্যাট","نجی سپورٹ چیٹ"],
  ["Crypto address","Dirección cripto","Adresse crypto","Krypto-Adresse","Endereço cripto","Indirizzo crypto","Crypto-adres","Kripto adresi","عنوان العملة الرقمية","क्रिप्टो पता","加密货币地址","暗号資産アドレス","암호화폐 주소","Криптоадрес","Alamat kripto","Anwani ya crypto","Adresă crypto","Adres kryptowaluty","Địa chỉ tiền mã hóa","ที่อยู่คริปโท","ক্রিপ্টো ঠিকানা","کرپٹو ایڈریس"],
  ["Bank account","Cuenta bancaria","Compte bancaire","Bankkonto","Conta bancária","Conto bancario","Bankrekening","Banka hesabı","حساب مصرفي","बैंक खाता","银行账户","銀行口座","은행 계좌","Банковский счёт","Rekening bank","Akaunti ya benki","Cont bancar","Konto bankowe","Tài khoản ngân hàng","บัญชีธนาคาร","ব্যাংক অ্যাকাউন্ট","بینک اکاؤنٹ"],
  ["Request deposit approval","Solicitar aprobación del depósito","Demander l’approbation du dépôt","Einzahlung genehmigen lassen","Solicitar aprovação do depósito","Richiedi approvazione del deposito","Stortingsgoedkeuring aanvragen","Yatırım onayı iste","طلب الموافقة على الإيداع","जमा स्वीकृति का अनुरोध करें","申请存款审批","入金承認をリクエスト","입금 승인 요청","Запросить подтверждение депозита","Minta persetujuan deposit","Omba idhini ya kuweka fedha","Solicită aprobarea depunerii","Poproś o zatwierdzenie wpłaty","Yêu cầu duyệt khoản nạp","ขออนุมัติการฝาก","জমার অনুমোদন চান","ڈپازٹ کی منظوری کی درخواست کریں"],
  ["Request send","Solicitar envío","Demander l’envoi","Versand beantragen","Solicitar envio","Richiedi invio","Verzending aanvragen","Gönderim iste","طلب الإرسال","भेजने का अनुरोध करें","申请发送","送金をリクエスト","전송 요청","Запросить отправку","Minta pengiriman","Omba kutuma","Solicită trimiterea","Poproś o wysłanie","Yêu cầu gửi","ขอส่ง","পাঠানোর অনুরোধ করুন","بھیجنے کی درخواست کریں"],
  ["Confirm swap","Confirmar intercambio","Confirmer l’échange","Tausch bestätigen","Confirmar troca","Conferma scambio","Wissel bevestigen","Takas işlemini onayla","تأكيد المبادلة","स्वैप की पुष्टि करें","确认兑换","交換を確定","교환 확인","Подтвердить обмен","Konfirmasi swap","Thibitisha ubadilishaji","Confirmă schimbul","Potwierdź wymianę","Xác nhận hoán đổi","ยืนยันการแลกเปลี่ยน","অদলবদল নিশ্চিত করুন","تبادلے کی تصدیق کریں"],
  ["Manage account","Administrar cuenta","Gérer le compte","Konto verwalten","Gerenciar conta","Gestisci account","Account beheren","Hesabı yönet","إدارة الحساب","खाता प्रबंधित करें","管理账户","アカウントを管理","계정 관리","Управление аккаунтом","Kelola akun","Simamia akaunti","Gestionează contul","Zarządzaj kontem","Quản lý tài khoản","จัดการบัญชี","অ্যাকাউন্ট পরিচালনা","اکاؤنٹ کا نظم کریں"],
  ["Pending deposit requests","Solicitudes de depósito pendientes","Demandes de dépôt en attente","Ausstehende Einzahlungsanfragen","Solicitações de depósito pendentes","Richieste di deposito in sospeso","Openstaande stortingsverzoeken","Bekleyen yatırım istekleri","طلبات الإيداع المعلقة","लंबित जमा अनुरोध","待处理的存款申请","保留中の入金リクエスト","대기 중인 입금 요청","Ожидающие запросы на пополнение","Permintaan deposit tertunda","Maombi ya kuweka fedha yanayosubiri","Solicitări de depunere în așteptare","Oczekujące prośby o wpłatę","Yêu cầu nạp đang chờ","คำขอฝากที่รอดำเนินการ","অপেক্ষমাণ জমার অনুরোধ","زیر التوا ڈپازٹ درخواستیں"],
  ["Pending send requests","Solicitudes de envío pendientes","Demandes d’envoi en attente","Ausstehende Sendeanfragen","Solicitações de envio pendentes","Richieste di invio in sospeso","Openstaande verzendverzoeken","Bekleyen gönderim istekleri","طلبات الإرسال المعلقة","लंबित भेजने के अनुरोध","待处理的发送申请","保留中の送金リクエスト","대기 중인 전송 요청","Ожидающие запросы на отправку","Permintaan pengiriman tertunda","Maombi ya kutuma yanayosubiri","Solicitări de trimitere în așteptare","Oczekujące prośby o wysłanie","Yêu cầu gửi đang chờ","คำขอส่งที่รอดำเนินการ","অপেক্ষমাণ পাঠানোর অনুরোধ","زیر التوا بھیجنے کی درخواستیں"],
  ["Approve","Aprobar","Approuver","Genehmigen","Aprovar","Approva","Goedkeuren","Onayla","موافقة","स्वीकृत करें","批准","承認","승인","Одобрить","Setujui","Idhinisha","Aprobă","Zatwierdź","Phê duyệt","อนุมัติ","অনুমোদন করুন","منظور کریں"],
  ["Choose an earning path below. Both stay together in your Earn dashboard.","Elige una opción para generar ingresos. Ambas aparecerán en tu panel de Earn.","Choisissez une option de rendement. Elles apparaîtront dans votre tableau Earn.","Wähle einen Verdienstweg. Beide findest du in deinem Earn-Dashboard.","Escolha uma forma de rendimento. Ambas ficam no painel Earn.","Scegli un’opportunità. Le troverai entrambe nella dashboard Earn.","Kies een manier om te verdienen. Beide staan in je Earn-dashboard.","Bir kazanç yolu seç. İkisini de Earn panelinde bulabilirsin.","اختر طريقة للربح. ستجد الخيارين في لوحة Earn.","कमाई का रास्ता चुनें। दोनों आपके Earn डैशबोर्ड में दिखेंगे।","选择一种收益方式，两种方式都会显示在 Earn 控制面板中。","収益方法を選択してください。どちらもEarnダッシュボードに表示されます。","수익 방식을 선택하세요. 두 방식 모두 Earn 대시보드에 표시됩니다.","Выберите способ заработка. Оба варианта будут доступны на панели Earn.","Pilih cara mendapatkan imbalan. Keduanya tersedia di dasbor Earn Anda.","Chagua njia ya kupata mapato. Zote zitaonekana kwenye dashibodi yako ya Earn.","Alege o metodă de câștig. Ambele vor apărea în tabloul Earn.","Wybierz sposób zarabiania. Oba znajdziesz w panelu Earn.","Chọn cách sinh lời. Cả hai sẽ hiển thị trong bảng điều khiển Earn.","เลือกวิธีรับผลตอบแทน ทั้งสองแบบจะแสดงในแดชบอร์ด Earn","একটি আয়ের পথ বেছে নিন। দুটিই আপনার Earn ড্যাশবোর্ডে থাকবে।","آمدنی کا طریقہ منتخب کریں۔ دونوں آپ کے Earn ڈیش بورڈ میں دکھائی دیں گے۔"],
  ["Your active staking positions will appear here.","Tus posiciones de staking activas aparecerán aquí.","Vos positions de staking actives apparaîtront ici.","Deine aktiven Staking-Positionen erscheinen hier.","Suas posições ativas de staking aparecerão aqui.","Le tue posizioni di staking attive appariranno qui.","Je actieve stakingposities verschijnen hier.","Aktif stake pozisyonların burada görünür.","ستظهر مراكز التخزين النشطة هنا.","आपकी सक्रिय स्टेकिंग पोज़िशन यहाँ दिखाई देंगी।","你的活跃质押仓位会显示在这里。","ステーキング中のポジションがここに表示されます。","활성 스테이킹 포지션이 여기에 표시됩니다.","Здесь появятся ваши активные позиции в стейкинге.","Posisi staking aktif Anda akan muncul di sini.","Nafasi zako za staking zitaonekana hapa.","Pozițiile active de staking vor apărea aici.","Aktywne pozycje stakingowe pojawią się tutaj.","Các vị thế staking đang hoạt động sẽ hiển thị tại đây.","ตำแหน่ง Stake ที่ใช้งานจะแสดงที่นี่","আপনার সক্রিয় স্টেকিং পজিশন এখানে দেখা যাবে।","آپ کی فعال اسٹیکنگ پوزیشنز یہاں ظاہر ہوں گی۔"],
  ["Send a message and continue the conversation here.","Envía un mensaje y continúa la conversación aquí.","Envoyez un message et poursuivez la conversation ici.","Sende eine Nachricht und führe das Gespräch hier fort.","Envie uma mensagem e continue a conversa aqui.","Invia un messaggio e continua qui la conversazione.","Stuur een bericht en ga het gesprek hier verder.","Mesaj gönder ve sohbete buradan devam et.","أرسل رسالة وتابع المحادثة هنا.","संदेश भेजें और बातचीत यहाँ जारी रखें।","发送消息并在此继续对话。","メッセージを送信して、ここで会話を続けましょう。","메시지를 보내고 여기에서 대화를 이어가세요.","Отправьте сообщение и продолжите разговор здесь.","Kirim pesan dan lanjutkan percakapan di sini.","Tuma ujumbe na uendelee na mazungumzo hapa.","Trimite un mesaj și continuă conversația aici.","Wyślij wiadomość i kontynuuj rozmowę tutaj.","Gửi tin nhắn và tiếp tục cuộc trò chuyện tại đây.","ส่งข้อความและสนทนาต่อที่นี่","বার্তা পাঠান এবং এখানে কথোপকথন চালিয়ে যান।","پیغام بھیجیں اور گفتگو یہاں جاری رکھیں۔"],
  ["Replies will appear in this conversation.","Las respuestas aparecerán en esta conversación.","Les réponses apparaîtront dans cette conversation.","Antworten erscheinen in diesem Gespräch.","As respostas aparecerão nesta conversa.","Le risposte appariranno in questa conversazione.","Reacties verschijnen in dit gesprek.","Yanıtlar bu sohbette görünür.","ستظهر الردود في هذه المحادثة.","जवाब इस बातचीत में दिखाई देंगे।","回复会显示在此对话中。","返信はこの会話に表示されます。","답변이 이 대화에 표시됩니다.","Ответы появятся в этом разговоре.","Balasan akan muncul dalam percakapan ini.","Majibu yataonekana kwenye mazungumzo haya.","Răspunsurile vor apărea în această conversație.","Odpowiedzi pojawią się w tej rozmowie.","Phản hồi sẽ hiển thị trong cuộc trò chuyện này.","คำตอบจะแสดงในการสนทนานี้","উত্তর এই কথোপকথনে দেখা যাবে।","جوابات اس گفتگو میں ظاہر ہوں گے۔"],
  ["Keep personal passwords and recovery phrases private.","Mantén en privado tus contraseñas y frases de recuperación.","Gardez vos mots de passe et phrases de récupération confidentiels.","Halte Passwörter und Wiederherstellungsphrasen geheim.","Mantenha suas senhas e frases de recuperação em sigilo.","Tieni private le password e le frasi di recupero.","Houd wachtwoorden en herstelzinnen privé.","Parolalarını ve kurtarma kelimelerini gizli tut.","احتفظ بكلمات المرور وعبارات الاسترداد سرية.","पासवर्ड और रिकवरी वाक्यांश निजी रखें।","请勿泄露密码和助记词。","パスワードやリカバリーフレーズは他人に教えないでください。","비밀번호와 복구 문구를 안전하게 보관하세요.","Не сообщайте пароли и фразы восстановления.","Jaga kerahasiaan kata sandi dan frasa pemulihan.","Weka nywila na vifungu vya kurejesha akaunti kuwa siri.","Păstrează private parolele și frazele de recuperare.","Chroń hasła i frazy odzyskiwania.","Giữ riêng tư mật khẩu và cụm từ khôi phục.","เก็บรหัสผ่านและวลีสำหรับกู้คืนไว้เป็นส่วนตัว","পাসওয়ার্ড ও রিকভারি ফ্রেজ গোপন রাখুন।","پاس ورڈ اور ریکوری فریز نجی رکھیں۔"],
  ["All customer accounts","Todas las cuentas de clientes","Tous les comptes clients","Alle Kundenkonten","Todas as contas de clientes","Tutti gli account cliente","Alle klantaccounts","Tüm müşteri hesapları","جميع حسابات العملاء","सभी ग्राहक खाते","所有客户账户","すべての顧客アカウント","모든 고객 계정","Все аккаунты клиентов","Semua akun pelanggan","Akaunti zote za wateja","Toate conturile clienților","Wszystkie konta klientów","Tất cả tài khoản khách hàng","บัญชีลูกค้าทั้งหมด","সব গ্রাহক অ্যাকাউন্ট","تمام صارفین کے اکاؤنٹس"],
  ["Account actions","Acciones de la cuenta","Actions du compte","Kontoaktionen","Ações da conta","Azioni account","Accountacties","Hesap işlemleri","إجراءات الحساب","खाता कार्रवाइयाँ","账户操作","アカウント操作","계정 작업","Действия с аккаунтом","Tindakan akun","Vitendo vya akaunti","Acțiuni asupra contului","Działania na koncie","Thao tác tài khoản","การดำเนินการบัญชี","অ্যাকাউন্টের কাজ","اکاؤنٹ کے اقدامات"],
  ["Save changes","Guardar cambios","Enregistrer les modifications","Änderungen speichern","Salvar alterações","Salva modifiche","Wijzigingen opslaan","Değişiklikleri kaydet","حفظ التغييرات","बदलाव सहेजें","保存更改","変更を保存","변경사항 저장","Сохранить изменения","Simpan perubahan","Hifadhi mabadiliko","Salvează modificările","Zapisz zmiany","Lưu thay đổi","บันทึกการเปลี่ยนแปลง","পরিবর্তন সংরক্ষণ করুন","تبدیلیاں محفوظ کریں"],
  ["Delete account","Eliminar cuenta","Supprimer le compte","Konto löschen","Excluir conta","Elimina account","Account verwijderen","Hesabı sil","حذف الحساب","खाता हटाएँ","删除账户","アカウントを削除","계정 삭제","Удалить аккаунт","Hapus akun","Futa akaunti","Șterge contul","Usuń konto","Xóa tài khoản","ลบบัญชี","অ্যাকাউন্ট মুছুন","اکاؤنٹ حذف کریں"],
  ["Start managing your digital assets today.","Empieza hoy a gestionar tus activos digitales.","Commencez à gérer vos actifs numériques dès aujourd’hui.","Verwalte noch heute deine digitalen Assets.","Comece a gerenciar seus ativos digitais hoje.","Inizia oggi a gestire i tuoi asset digitali.","Beheer vandaag nog je digitale assets.","Dijital varlıklarını yönetmeye bugün başla.","ابدأ إدارة أصولك الرقمية اليوم.","आज ही अपनी डिजिटल संपत्तियों का प्रबंधन शुरू करें।","立即开始管理你的数字资产。","今日からデジタル資産の管理を始めましょう。","오늘 디지털 자산 관리를 시작하세요.","Начните управлять цифровыми активами уже сегодня.","Mulai kelola aset digital Anda hari ini.","Anza kusimamia rasilimali zako za kidijitali leo.","Începe să-ți gestionezi activele digitale chiar astăzi.","Zacznij zarządzać swoimi aktywami cyfrowymi już dziś.","Bắt đầu quản lý tài sản số ngay hôm nay.","เริ่มจัดการสินทรัพย์ดิจิทัลของคุณวันนี้","আজই আপনার ডিজিটাল সম্পদ পরিচালনা শুরু করুন।","آج ہی اپنے ڈیجیٹل اثاثوں کا انتظام شروع کریں۔"],
];
const appPhrases = Object.fromEntries(landingLanguages.map(([code], index) => [code, Object.fromEntries(appPhraseRows.map((row) => [row[0], row[index + 1]]))]));
let activeRoute = "landing";
let activeAuthMode = null;
function localizeApp(root = document.body) {
  if (landingLanguage === "en") return;
  const phrases = appPhrases[landingLanguage] || appPhrases.en;
  const phraseEntries = Object.entries(phrases).sort((a, b) => b[0].length - a[0].length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const source = node.nodeValue;
    const trimmed = source.trim();
    if (!trimmed) continue;
    const start = source.match(/^\s*/)?.[0] || "";
    const end = source.match(/\s*$/)?.[0] || "";
    let translated = trimmed;
    for (const [english, localized] of phraseEntries) {
      const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      translated = translated.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu"), `$1${localized}`);
    }
    if (translated !== trimmed) {
      if (trimmed === trimmed.toLocaleUpperCase()) translated = translated.toLocaleUpperCase(landingLanguage);
      node.nodeValue = `${start}${translated}${end}`;
    }
  }
  root.querySelectorAll?.("input[placeholder], textarea[placeholder], [aria-label]").forEach((element) => {
    for (const attribute of ["placeholder", "aria-label"]) {
      const value = element.getAttribute(attribute);
      if (value && phrases[value]) element.setAttribute(attribute, phrases[value]);
    }
  });
}
new MutationObserver((records) => {
  if (landingLanguage === "en") return;
  for (const record of records) {
    if (record.type === "characterData") localizeApp(record.target.parentElement || document.body);
    else record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) localizeApp(node);
      else if (node.nodeType === Node.TEXT_NODE) localizeApp(node.parentElement || document.body);
    });
  }
}).observe(document.body, { childList: true, characterData: true, subtree: true });
function applyLanguageDocument() {
  document.documentElement.lang = landingLanguage;
  document.documentElement.dir = ["ar", "ur"].includes(landingLanguage) ? "rtl" : "ltr";
}

function toggleLandingNav() {
  const panel = document.getElementById("landingNavLinks");
  const button = document.getElementById("landingNavToggle");
  if (!panel || !button) return;
  const opening = !panel.classList.contains("open");
  panel.classList.toggle("open", opening);
  button.setAttribute("aria-expanded", String(opening));
  button.setAttribute("aria-label", opening ? "Close menu" : "Open menu");
  button.innerHTML = opening
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
}
function closeLandingNav() {
  const panel = document.getElementById("landingNavLinks");
  if (!panel || !panel.classList.contains("open")) return;
  panel.classList.remove("open");
  const button = document.getElementById("landingNavToggle");
  button?.setAttribute("aria-expanded", "false");
  button?.setAttribute("aria-label", "Open menu");
  if (button) button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
}
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  if (target.closest("#landingNavToggle")) {
    toggleLandingNav();
    return;
  }
  const clickedInsideNav = (event.composedPath?.() || []).some(
    (node) => node instanceof Element && node.matches(".landing-nav"),
  );
  if (!clickedInsideNav) closeLandingNav();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const wasOpen = document.getElementById("landingNavLinks")?.classList.contains("open");
    closeLandingNav();
    if (wasOpen) document.getElementById("landingNavToggle")?.focus();
  }
});

function landing() {
  activeRoute = "landing";
  activeAuthMode = null;
  applyLanguageDocument();
  const t = landingTranslations[landingLanguage] || landingTranslations.en;
  document.documentElement.lang = landingLanguage;
  document.documentElement.dir = ["ar", "ur"].includes(landingLanguage) ? "rtl" : "ltr";
  const languageOptions = landingLanguages.map(([code, name]) => `<option value="${code}" ${code === landingLanguage ? "selected" : ""}>${name}</option>`).join("");
  app.innerHTML = `<section class="landing"><nav class="landing-nav">${brand}<div class="nav-controls"><label class="language-picker"><span aria-hidden="true">◎</span><span class="sr-only">${t[0]}</span><select aria-label="${t[0]}" onchange="setLandingLanguage(this.value)">${languageOptions}</select></label><button class="nav-toggle" id="landingNavToggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="landingNavLinks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><div class="nav-links" id="landingNavLinks"><button class="outline" onclick="auth('login')">${t[1]}</button><button class="primary" onclick="auth('signup')">${t[2]}</button></div></div></nav><div class="hero"><div class="hero-copy"><div class="eyebrow">${t[3]}</div><h1><span>${t[4]}</span><em>${t[5]}</em></h1><p>${t[6]}</p><div class="hero-actions"><button class="primary" onclick="auth('signup')">${t[7]} <span aria-hidden="true">→</span></button><button class="text-button" onclick="auth('login')">${t[8]}</button></div><div class="hero-proof"><span>◉ ${t[9]}</span><span>◉ ${t[10]}</span></div></div><div class="wallet-preview"><div class="wallet-top"><span>${t[11]}</span><span aria-hidden="true">•••</span></div><div class="wallet-value">$24,864.21</div><span class="gain">↗ ${t[12]}</span><div class="coins"><div class="coin">₿<b>Bitcoin</b><small>${t[13]}</small></div><div class="coin">◆<b>Ethereum</b><small>${t[13]}</small></div><div class="coin">$<b>USDC</b><small>${t[14]}</small></div></div></div></div><div class="landing-body"><section class="market-section"><div class="section-heading"><div><div class="eyebrow">${t[15]}</div><h2>${t[16]}</h2></div><span class="market-status" id="landingMarketStatus">${t[17]}</span></div><div class="market-grid"><article class="market-card"><span class="token">₿</span><div><b>Bitcoin</b><small>BTC</small></div><strong data-market="BTC">—</strong></article><article class="market-card"><span class="token eth">◆</span><div><b>Ethereum</b><small>ETH</small></div><strong data-market="ETH">—</strong></article><article class="market-card"><span class="token usdc">$</span><div><b>USD Coin</b><small>USDC</small></div><strong data-market="USDC">—</strong></article></div></section><section class="feature-grid"><article><span>⌁</span><h3>${t[18]}</h3><p>${t[19]}</p></article><article><span>✓</span><h3>${t[20]}</h3><p>${t[21]}</p></article><article><span>◈</span><h3>${t[22]}</h3><p>${t[23]}</p></article></section><section class="security-callout"><div><div class="eyebrow">${t[24]}</div><h2>${t[25]}</h2><p>${t[26]}</p></div><button class="primary" onclick="auth('signup')">${t[27]}</button></section></div></section>`;
  loadLandingMarkets();
}
function setLandingLanguage(language) {
  if (!landingTranslations[language]) return;
  landingLanguage = language;
  localStorage.setItem("vf_landing_language", language);
  applyLanguageDocument();
  if (activeAuthMode) auth(activeAuthMode);
  else if (activeRoute === "landing" || !token) landing();
  else ({ dashboard, earn, activity, support, admin }[activeRoute] || dashboard)();
}
async function loadLandingMarkets() {
  try {
    const data = await api("/api/market/prices");
    document.querySelectorAll("[data-market]").forEach((element) => {
      const quote = data[element.dataset.market];
      element.textContent = `${money(quote.usd)}  ${quote.change >= 0 ? "↗" : "↘"} ${Math.abs(quote.change).toFixed(2)}%`;
    });
    const status = document.getElementById("landingMarketStatus");
    if (status)
      status.textContent = data.stale
        ? "Market data unavailable"
        : "Live prices · USD";
  } catch {
    const status = document.getElementById("landingMarketStatus");
    if (status) status.textContent = "Market snapshot unavailable";
  }
}
function auth(mode) {
  activeRoute = "auth";
  activeAuthMode = mode;
  applyLanguageDocument();
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">${brand}<h1>${mode === "login" ? "Welcome back" : "Create your Vault"}</h1><p>${mode === "login" ? "Sign in to access your Vault." : "Start managing your digital assets today."}</p><div id="err"></div>${mode === "signup" ? '<label class="field">FULL NAME</label><input class="input" id="name" placeholder="Your name">' : ""}<label class="field">EMAIL ADDRESS</label><input class="input" id="email" type="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="input" id="password" type="password" placeholder="At least 8 characters">${mode === "signup" ? '<label class="field">CONFIRM PASSWORD</label><input class="input" id="confirmPassword" type="password" placeholder="Type your password again" autocomplete="new-password">' : ""}<button class="primary wide" onclick="submitAuth('${mode}')">${mode === "login" ? "Sign in" : "Create account"}</button><div class="switch">${mode === "login" ? 'New to OnchainVault? <span class="link" onclick="auth(\'signup\')">Create an account</span>' : 'Already have an account? <span class="link" onclick="auth(\'login\')">Sign in</span>'}</div>${mode === "login" ? '<div class="demo">Private access · Admin-reviewed accounts</div>' : ""}</div></section>`;
  localizeApp(app);
}
async function submitAuth(mode) {
  try {
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const nameInput = document.getElementById("name");
    if (mode === "signup") {
      const confirmPasswordInput = document.getElementById("confirmPassword");
      if (passwordInput.value !== confirmPasswordInput.value) {
        document.getElementById("err").innerHTML =
          '<div class="error">Passwords do not match. Please re-enter them.</div>';
        return;
      }
    }
    const body = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    };
    if (mode === "signup") body.name = nameInput.value.trim();
    const data = await api(
      `/api/auth/${mode === "login" ? "login" : "signup"}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    token = data.token;
    localStorage.setItem("vf_token", token);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    lastHeartbeatAt = Date.now();
    me = data.user;

    app.innerHTML = `<section class="auth-shell"><div class="auth-card">${brand}<h1>Welcome back</h1><p>Preparing your dashboard...</p><div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 0 8px;">
      <div class="loading-spinner" aria-label="Loading"></div>
      <div style="font-size:0.96rem;color:#cbd5e1;">Securely signing you in…</div>
    </div><div id="err"></div></div></section>`;

    await new Promise((resolve) => setTimeout(resolve, 5000));
    dashboard();
  } catch (error) {
    const errorElement = document.getElementById("err");
    if (errorElement)
      errorElement.innerHTML = `<div class="error">${error.message}</div>`;
  }
}
function shell(body, tab = "dashboard") {
  activeRoute = tab;
  activeAuthMode = null;
  applyLanguageDocument();
  if (tab !== "earn") clearInterval(puzzleTimer);
  if (tab !== "support" && supportChatTimer) {
    clearInterval(supportChatTimer);
    supportChatTimer = null;
  }
  if (tab !== "admin" && adminSupportInboxTimer) {
    clearInterval(adminSupportInboxTimer);
    adminSupportInboxTimer = null;
  }
  if (tab !== "admin" && adminSupportChatTimer) {
    clearInterval(adminSupportChatTimer);
    adminSupportChatTimer = null;
    adminSupportConversationId = null;
  }
  app.innerHTML = `<div class="app-shell ${tab === "support" ? "support-app-shell" : ""}"><aside class="side">${brand}<div class="menu"><button class="${tab === "dashboard" ? "active" : ""}" onclick="dashboard()">◈ &nbsp; Overview</button><button class="${tab === "earn" ? "active" : ""}" onclick="earn()">✦ &nbsp; Earn</button><button class="${tab === "activity" ? "active" : ""}" onclick="activity()">⇄ &nbsp; Activity</button><button onclick="walletModal('receive')">＋ &nbsp; Add funds</button>${me.role === "admin" ? `<button class="${tab === "admin" ? "active" : ""}" onclick="admin()" id="adminTab">♙ &nbsp; Admin Console<span class="nav-badge" id="adminSupportBadge" hidden></span></button>` : `<button class="support-tab ${tab === "support" ? "active" : ""}" onclick="support()" id="supportTab">☏ &nbsp; Chat with support<span class="nav-badge" id="supportUnreadBadge" hidden></span></button>`}</div><div class="side-footer"><button class="signout-switch" type="button" onclick="logout()" aria-label="Sign out" title="Sign out"><span class="sr-only">Sign out</span><span class="signout-switch-track" aria-hidden="true"><span class="signout-switch-knob"><svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6"/></svg></span></span></button></div></aside><section class="content">${body}</section></div>`;
  localizeApp(app);
  refreshSupportBadges();
  if (!supportBadgeTimer) supportBadgeTimer = setInterval(refreshSupportBadges, 20000);
  if (tab === "admin" && !adminSupportInboxTimer) adminSupportInboxTimer = setInterval(refreshAdminSupportInbox, 12000);
}
function setNavBadge(id, count) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = !count;
}
async function refreshSupportBadges() {
  if (!token) return;
  try {
    const unread = await api("/api/support/unread");
    setNavBadge("supportUnreadBadge", unread.userUnread || 0);
    setNavBadge("adminSupportBadge", unread.adminUnread || 0);
  } catch {}
}
function supportMessageRows(messages = [], role = "user") {
  if (!messages.length) return `<div class="support-empty"><span class="support-empty-icon">✦</span><b>How can we help?</b><p>Send a message to start a private conversation with OnchainVault support.</p></div>`;
  return messages.map((message) => {
    const mine = message.senderRole === role;
    const sender = mine ? (role === "admin" ? "Support team" : "You") : (message.senderRole === "admin" ? "Support team" : escapeHtml(message.senderName || "Customer"));
    const date = new Date(message.createdAt);
    const timestamp = Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<article class="support-message ${mine ? "mine" : "theirs"}"><div class="support-message-meta"><b>${sender}</b><time>${timestamp}</time></div><p>${escapeHtml(message.text).replace(/\n/g, "<br>")}</p></article>`;
  }).join("");
}
function renderSupportMessages(containerId, messages, role, forceBottom = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  container.innerHTML = supportMessageRows(messages, role);
  if (forceBottom || nearBottom) container.scrollTop = container.scrollHeight;
}
function configureSupportComposer(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;
  const update = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    button.disabled = !input.value.trim();
  };
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (input.value.trim() && !button.disabled) input.form.requestSubmit();
    }
  });
  update();
}
let activeSupportConversation = null;
async function support() {
  if (supportChatTimer) clearInterval(supportChatTimer);
  supportChatTimer = null;
  try {
    const response = await api("/api/support/conversation");
    activeSupportConversation = response.conversation;
    shell(`<main class="support-screen"><header class="support-screen-header"><button class="support-back" type="button" onclick="dashboard()" aria-label="Back to dashboard"><span aria-hidden="true">←</span><span>Vault</span></button><span class="support-agent-avatar" aria-hidden="true">OV</span><div class="support-agent-copy"><b>OnchainVault support</b><span>Private conversation · Replies appear here</span></div><span class="support-status"><span></span>Secure chat</span></header><div class="support-messages" id="supportMessages" aria-live="polite"></div><form class="support-composer support-screen-composer" onsubmit="sendSupportMessage(event)"><label class="sr-only" for="supportMessageInput">Your message</label><textarea id="supportMessageInput" maxlength="2000" rows="1" placeholder="Write a message…" required></textarea><div class="support-composer-footer"><span>Messages are automatically cleared after 24 hours. Never share passwords or recovery phrases.</span><button class="primary" id="supportSendButton" type="submit" disabled>Send <span aria-hidden="true">↗</span></button></div></form></main>`, "support");
    renderSupportMessages("supportMessages", activeSupportConversation?.messages || [], "user", true);
    configureSupportComposer("supportMessageInput", "supportSendButton");
    refreshSupportBadges();
    supportChatTimer = setInterval(refreshSupportConversation, 8000);
  } catch (error) {
    shell(`<main class="support-screen support-error-screen"><header class="support-screen-header"><button class="support-back" type="button" onclick="dashboard()" aria-label="Back to dashboard"><span aria-hidden="true">←</span><span>Vault</span></button><b>OnchainVault support</b></header><section class="card"><p class="error">${escapeHtml(error.message)}</p><button class="primary" onclick="support()">Try again</button></section></main>`, "support");
  }
}
async function refreshSupportConversation() {
  if (!document.getElementById("supportMessages")) return;
  try {
    const response = await api("/api/support/conversation");
    activeSupportConversation = response.conversation;
    renderSupportMessages("supportMessages", activeSupportConversation?.messages || [], "user");
    refreshSupportBadges();
  } catch {}
}
async function sendSupportMessage(event) {
  event.preventDefault();
  const input = document.getElementById("supportMessageInput");
  const button = document.getElementById("supportSendButton");
  const text = input.value.trim();
  if (!text) return;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const response = await api("/api/support/messages", { method: "POST", body: JSON.stringify({ text }) });
    activeSupportConversation = response.conversation;
    input.value = "";
    renderSupportMessages("supportMessages", activeSupportConversation.messages, "user", true);
    refreshSupportBadges();
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = !input.value.trim();
    button.innerHTML = 'Send message <span aria-hidden="true">↗</span>';
    input.focus();
  }
}
function portfolioValue(assets = [], prices = livePrices, stakes = []) {
  return (assets || []).reduce(
    (sum, asset) =>
      sum + Number(asset.amount || 0) * (prices[asset.symbol]?.usd ?? 0),
    (stakes || []).reduce(
      (sum, stake) => sum + Number(stake.amount || 0) * (prices[stake.symbol]?.usd ?? 0),
      0,
    ),
  );
}
function formatQuantity(value) {
  const quantity = Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(quantity)
    ? quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : String(value ?? "");
}
function formatAssetAmount(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity)
    ? quantity.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : String(value ?? "");
}
function formatTransactionAmount(value) {
  const amount = String(value ?? "0").trim();
  const quantity = Number(amount.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(quantity)) return amount;
  const formatted = formatQuantity(quantity);
  return amount.startsWith("+") && quantity > 0 ? `+${formatted}` : formatted;
}
function assetRows() {
  return me.assets
    .map((asset) => {
      const [icon, name, cls] = meta[asset.symbol] || ["•", asset.symbol, ""];
      const market = livePrices[asset.symbol];
      return `<div class="asset"><div class="asset-left"><span class="token ${cls}">${icon}</span><div><b>${name}</b><div class="small live-price" data-symbol="${asset.symbol}">Current value: ${money(market.usd)} · ${market.change.toFixed(2)}% (24h)</div><div class="asset-balance"><span>Your holdings</span><strong>${formatQuantity(asset.amount)} <small>${asset.symbol}</small></strong></div></div></div><b class="holding-value" data-symbol="${asset.symbol}" data-amount="${asset.amount}">${money(asset.amount * market.usd)}</b></div>`;
    })
    .join("");
}
async function refreshLivePrices() {
  try {
    const data = await api("/api/market/prices");
    livePrices = data;
    document.querySelectorAll(".live-price").forEach((element) => {
      const market = livePrices[element.dataset.symbol];
      element.textContent = `Current value: ${money(market.usd)} · ${market.change.toFixed(2)}% (24h)`;
    });
    document.querySelectorAll(".holding-value").forEach((element) => {
      element.textContent = money(
        Number(element.dataset.amount) * livePrices[element.dataset.symbol].usd,
      );
    });
    document.querySelectorAll(".tx[data-pending='true']").forEach((row) => {
      const symbol = row.dataset.asset;
      const valueNode = row.querySelector("[data-live-value]");
      const amount = Number(
        String(row.dataset.amount || "0").replace(/[^0-9.-]/g, ""),
      );
      if (valueNode && symbol && livePrices[symbol]) {
        valueNode.textContent = money(
          Math.abs(amount) * livePrices[symbol].usd,
        );
      }
    });
    const total = portfolioValue(me.assets, livePrices, me.stakes);
    const totalElement = document.getElementById("livePortfolioValue");
    if (totalElement) totalElement.textContent = money(total);
    const earnBalance = document.getElementById("earnBalance");
    if (earnBalance) earnBalance.textContent = money(total);
    const earnGate = document.querySelector("[data-earn-gate]");
    if (earnGate && (earnGate.dataset.earnGate === "true") !== (total >= 2000))
      earn();
    const stamp = document.getElementById("marketUpdated");
    if (stamp)
      stamp.textContent = data.stale
        ? "Market data temporarily unavailable"
        : `Live market prices · updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    /* Keep the last known values visible if market data is unavailable. */
  }
}
function startPriceRefresh() {
  refreshLivePrices();
  if (!priceTimer) priceTimer = setInterval(refreshLivePrices, 60_000);
}
function transactionRows(all = false) {
  const txs = all ? me.transactions : me.transactions.slice(0, 5);
  return (
    txs
      .map((tx) => {
        const [icon, , cls] = meta[tx.asset] || ["•", tx.asset, ""];
        const amountValue = Number(
          String(tx.amount || "0").replace(/[^0-9.-]/g, ""),
        );
        const displayValue =
          tx.status === "pending" && tx.asset && livePrices[tx.asset]
            ? money(Math.abs(amountValue) * livePrices[tx.asset].usd)
            : tx.value;
        const displayAmount = formatTransactionAmount(tx.amount);

        const state =
          tx.status === "pending"
            ? '<span class="status off">Pending</span>'
            : tx.status === "cancelled"
              ? '<span class="status off">Cancelled</span>'
              : "";

        const when = tx.createdAt
          ? `<span data-timeago="${tx.createdAt}">${timeAgo(tx.createdAt)}</span>`
          : tx.time;

        return `<div class="tx" data-asset="${tx.asset}" data-amount="${tx.amount}" data-pending="${tx.status === "pending"}"><div class="tx-left"><span class="token ${cls}">${icon}</span><div><b>${escapeHtml(tx.title)}</b><div class="small">${escapeHtml(tx.subtitle)} · ${when}</div></div></div><div class="amount ${tx.amount.startsWith("+") && tx.status !== "cancelled" ? "positive" : ""}">${displayAmount}<div class="small" data-live-value>${displayValue}</div>${state}</div></div>`;
      })
      .join("") ||
    '<p class="small">No activity yet. Add funds to begin building your Vault.</p>'
  );
}
function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then)) return "";
  const now = new Date();
  const diff = Math.floor((now - then) / 1000);
  const fmt = (d) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 60) return "Just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      86400000,
  );
  if (days === 0) return `Today, ${fmt(then)}`;
  if (days === 1) return `Yesterday, ${fmt(then)}`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${then.toLocaleDateString([], { month: "short", day: "numeric" })}, ${fmt(then)}`;
}
function refreshTimeLabels() {
  document.querySelectorAll("[data-timeago]").forEach((el) => {
    const iso = el.dataset.timeago;
    el.textContent = iso ? timeAgo(iso) : "";
  });
}
function startTimeRefresh() {
  refreshTimeLabels();
  if (!timeTimer) timeTimer = setInterval(refreshTimeLabels, 30_000);
}
let timeTimer = null;
function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
function dashboard() {
  shell(
    `<header class="topbar"><div><h1>${timeGreeting()}, ${me.name.split(" ")[0]}.</h1><p>Here’s how your Vault is doing today.</p></div><div class="profile"><div class="avatar">${initials(me.name)}</div>${me.name}</div></header><div class="grid"><div><div class="card balance-card"><div class="balance-label">Total Vault value</div><div class="balance" id="livePortfolioValue">${money(portfolioValue(me.assets, livePrices, me.stakes))}</div><span class="gain">↗ ${me.change}% this month</span><div class="actions"><button class="action" onclick="walletModal('receive')">↓ Receive</button><button class="action secondary" onclick="walletModal('send')">↑ Send</button><button class="action secondary" onclick="walletModal('swap')">⇄ Swap</button></div></div><div class="card" style="margin-top:18px"><h3>Your assets</h3><div class="small" id="marketUpdated">Loading live market prices…</div>${assetRows()}</div></div><div class="card"><h3>Recent activity</h3>${transactionRows()}<div class="switch" style="text-align:left"><span class="link" onclick="activity()">View all activity →</span></div></div></div>`,
  );
  startPriceRefresh();
  startTimeRefresh();
}
function gamePairsForLevel(level) {
  if (level <= 1) return 6;
  return Math.min(50, Math.round(16 + ((level - 2) / 48) * 34));
}
function earn() {
  clearInterval(puzzleTimer);
  const balance = portfolioValue(me.assets, livePrices, me.stakes);
  const eligible = balance >= 2000;
  const game = me.earnGame || { level: 1, maxLevel: 50, pendingProfitUsd: 0, rewardCycleBalanceUsd: 0, payoutThresholdUsd: 0, challenge: null };
  const challenge = game.challenge;
  const activeRound = challenge && !challenge.completed && !challenge.abandoned;
  const pairs = challenge?.pairs || gamePairsForLevel(game.level || 1);
  puzzleState = {
    challengeId: activeRound ? challenge.id : null,
    deck: challenge ? [...challenge.visibleCards] : Array(pairs * 2).fill(null),
    open: activeRound ? [...challenge.openIndices] : [],
    matched: activeRound ? [...challenge.matchedIndices] : challenge?.completed ? [...(challenge.matchedIndices || [])] : [],
    moves: activeRound ? challenge.moves : challenge?.moves || 0,
    busy: false,
    started: Boolean(activeRound && challenge.resumedAt),
    startedAt: activeRound ? challenge.resumedAt : null,
    elapsedMs: activeRound ? Number(challenge.elapsedMs || 0) : 0,
  };
  const pendingProfit = Number(game.pendingProfitUsd || 0);
  const threshold = Number(game.payoutThresholdUsd || 0);
  const progress = threshold > 0 ? Math.min(100, pendingProfit / threshold * 100) : 0;
  const payoutCopy = balance <= 0
    ? "A starting balance is required for game rewards. Rounds still advance your difficulty."
    : threshold > 0
      ? `${money(pendingProfit)} accumulated · ${money(Math.max(0, threshold - pendingProfit))} until transfer to your balance`
      : "Complete a round to start building your game reward balance.";
  const lastReward = game.lastReward;
  const lastRoundCopy = activeRound
    ? "Round in progress · find every matching pair."
    : challenge?.abandoned
      ? `Round ${challenge.level} quit · no reward earned. Start again at this level.`
    : challenge?.completed && lastReward
      ? lastReward.rewardUsd > 0
        ? `Round ${lastReward.level} · ${lastReward.elapsedSeconds}s · ${lastReward.moves} moves · ${lastReward.rewardRatePercent.toFixed(3)}% rate · ${lastReward.payoutUsd > 0 ? `${money(lastReward.payoutUsd)} transferred to your balance.` : `${money(lastReward.rewardUsd)} added to game profits.`}`
        : `Round ${lastReward.level} complete · no reward without a starting balance.`
      : `Level ${game.level || 1} · complete the round to earn from ${challenge?.pairs || pairs} pairs.`;
  const positions = (me.stakes || []).map((stake) => {
    const [icon, name, cls] = meta[stake.symbol] || ["•", stake.symbol, ""];
    const nextReward = stakeNextRewardDate(stake);
    const monthlyReward = Number(stake.amount) * 0.1;
    return `<article class="card position-card"><div class="position-main"><span class="token ${cls}">${icon}</span><div><b>${name} staking</b><div class="small">${formatAssetAmount(stake.amount)} ${stake.symbol} staked</div></div></div><div class="position-stat"><span>Monthly reward</span><strong>+${formatAssetAmount(monthlyReward)} ${stake.symbol}</strong></div><div class="position-stat"><span>Next reward</span><strong>${nextReward.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</strong></div><button class="outline unstake-button" onclick="unstake('${stake.id}')">Unstake</button></article>`;
  }).join("");
  const totalStakedValue = (me.stakes || []).reduce((sum, stake) => sum + Number(stake.amount || 0) * (livePrices[stake.symbol]?.usd || 0), 0);
  const stakingSection = `<section class="earn-section staking-section"><div class="earn-section-heading"><div><div class="eyebrow">Flexible staking</div><h2>Stake crypto</h2><p>Earn 10% monthly on supported assets. Rewards are paid in the same crypto.</p></div><div class="earn-section-value"><span>Current staked value</span><strong>${money(totalStakedValue)}</strong></div></div><div class="earn-grid"><article class="card earn-task stake-offer"><div class="offer-heading"><div class="task-icon">◈</div><span class="rate-badge">10% monthly</span></div><div class="task-tag">FLEXIBLE STAKING</div><h3>Choose an asset to stake</h3><p>Stake available crypto from your balance and track each position’s next monthly reward.</p><div class="task-footer"><span class="small">Unstake any time</span><button class="primary" onclick="startStaking()" ${eligible ? "" : "disabled"}>${eligible ? "Start staking" : "Unlock at $2,000"}</button></div></article></div>${positions ? `<div class="active-stakes"><div class="section-heading"><div><div class="eyebrow">Your positions</div><h2>Active staking</h2></div><span class="small">${(me.stakes || []).length} position${(me.stakes || []).length === 1 ? "" : "s"}</span></div><div class="position-list">${positions}</div></div>` : `<p class="earn-empty-state">Your active staking positions will appear here.</p>`}</section>`;
  const puzzleAction = activeRound && puzzleState.started
    ? `<button class="outline quit-puzzle-button" id="puzzleQuitButton" onclick="quitPuzzleRound()">Quit round</button>`
    : `<button class="outline" id="puzzleStartButton" onclick="startPuzzle()">${activeRound ? "Resume round" : challenge?.completed ? "Start next level" : challenge?.abandoned ? "Start new round" : "Start puzzle"}</button>`;
  const gameSection = `<section class="earn-section game-section"><div class="earn-section-heading"><div><div class="eyebrow">Puzzle rewards</div><h2>Crypto match</h2><p>Complete level 1 to unlock a 16-pair puzzle. Later levels add pairs until the 50-pair cap.</p></div><div class="game-level-badge">Level ${game.level || 1} <small>/ ${game.maxLevel || 50}</small></div></div><div class="game-profit-card card"><div class="game-profit-head"><div><span class="eyebrow">Game profit balance</span><h3>${money(pendingProfit)}</h3></div><span class="small">${threshold > 0 ? `of ${money(threshold)}` : "5% payout target"}</span></div><div class="progress-track" role="progressbar" aria-label="Progress to game reward transfer" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.toFixed(0)}"><span style="width:${progress.toFixed(2)}%"></span></div><p class="game-profit-copy">${payoutCopy}</p></div><div class="earn-grid"><article class="card earn-task puzzle-card"><div class="offer-heading"><div class="task-icon task-icon-green">⌘</div><span class="puzzle-label">LEVEL ${challenge?.level || game.level || 1} · ${pairs} PAIRS</span></div><div class="task-tag">ONCHAIN PUZZLE</div><h3>Match the crypto tiles</h3><p>Each round starts at 0.05% of your balance. Faster rounds with fewer moves earn a higher rate; slower rounds and extra moves reduce it. Higher levels increase the base rate. Game profits transfer when they reach 5% of your starting balance.</p><div class="puzzle-scoreline"><span id="puzzleProgress">${challenge?.completed ? pairs : challenge?.matchedIndices?.length / 2 || 0} of ${pairs} pairs · ${challenge?.moves || 0} moves</span><span id="puzzleClock">${puzzleClockLabel()}</span></div><div class="puzzle-board" id="puzzleBoard" aria-label="Crypto matching puzzle"></div><div class="puzzle-foot"><span class="small" id="puzzleResult">${lastRoundCopy}</span>${puzzleAction}</div></article></div></section>`;
  shell(
    `<header class="topbar"><div><h1>Earn</h1><p>Put your assets to work and build your Vault.</p></div><div class="profile"><div class="avatar">✦</div>Earn</div></header><section class="card earn-summary" data-earn-gate="${eligible}"><div><div class="balance-label">Total Vault value</div><div class="balance" id="earnBalance">${money(balance)}</div><div class="earn-status ${eligible ? "eligible" : "locked"}">${eligible ? "Available to stake" : "Locked · $2,000 minimum balance"}</div></div></section><section class="earn-welcome"><div><div class="eyebrow">Earn opportunities</div><h2>Make more of your assets.</h2><p>Choose an earning path below. Both stay together in your Earn dashboard.</p></div><span class="earn-spark">✦</span></section>${stakingSection}${gameSection}`,
    "earn",
  );
  renderPuzzle();
  if (puzzleState.started) startPuzzleClock();
  startPriceRefresh();
}
function stakeNextRewardDate(stake) {
  const date = new Date(stake.startedAt);
  const targetMonth = date.getUTCMonth() + Number(stake.maturedMonths || 0) + 1;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}
function startStaking() {
  if (portfolioValue(me.assets, livePrices, me.stakes) < 2000) return;
  const available = (me.assets || []).filter((asset) => Number(asset.amount) > 0);
  if (!available.length) {
    showNotice("There are no available assets to stake. Unstake a position or add funds to continue.", "No available assets");
    return;
  }
  const choices = available.map((asset) => {
    const [icon, name] = meta[asset.symbol] || ["•", asset.symbol];
    return `<option value="${asset.symbol}">${icon} ${asset.symbol} · ${name}</option>`;
  }).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-bg" id="stakeModal"><section class="modal stake-modal" role="dialog" aria-modal="true" aria-labelledby="stakeTitle"><div class="modal-head"><h2 id="stakeTitle">Start staking</h2><button class="close" onclick="document.getElementById('stakeModal').remove()" aria-label="Close">×</button></div><p class="stake-intro">Earn <strong>10% monthly</strong> on your staked amount. Rewards are credited in the same crypto.</p><label class="field" for="stakeSymbol">CRYPTO ASSET</label><select class="input" id="stakeSymbol" onchange="updateStakeEstimate()">${choices}</select><div class="available-line" id="stakeAvailable"></div><label class="field" for="stakeAmount">AMOUNT TO STAKE</label><input class="input" id="stakeAmount" type="number" min="0.0000001" step="0.0000001" placeholder="Enter amount" oninput="updateStakeEstimate()"><div class="stake-estimate" id="stakeEstimate">Estimated monthly reward: —</div><div id="stakeError"></div><button class="primary wide" id="stakeSubmit" onclick="submitStake()">Confirm stake</button></section></div>`);
  updateStakeEstimate();
  document.getElementById("stakeAmount").focus();
}
function updateStakeEstimate() {
  const symbol = document.getElementById("stakeSymbol")?.value;
  const amountInput = document.getElementById("stakeAmount");
  const asset = (me.assets || []).find((item) => item.symbol === symbol);
  if (!symbol || !asset || !amountInput) return;
  const amount = Number(amountInput.value);
  document.getElementById("stakeAvailable").textContent = `Available: ${formatAssetAmount(asset.amount)} ${symbol} · ${money(asset.amount * (livePrices[symbol]?.usd || 0))}`;
  document.getElementById("stakeEstimate").textContent = `Estimated monthly reward: ${amount > 0 ? `${formatAssetAmount(amount * 0.1)} ${symbol} (${money(amount * 0.1 * (livePrices[symbol]?.usd || 0))})` : "—"}`;
  amountInput.max = String(asset.amount);
}
async function submitStake() {
  const button = document.getElementById("stakeSubmit");
  const error = document.getElementById("stakeError");
  const symbol = document.getElementById("stakeSymbol").value;
  const amount = Number(document.getElementById("stakeAmount").value);
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner"></span>Starting stake…';
  error.innerHTML = "";
  try {
    me = await api("/api/earn/stakes", { method: "POST", body: JSON.stringify({ symbol, amount }) });
    document.getElementById("stakeModal").remove();
    earn();
  } catch (issue) {
    error.innerHTML = `<div class="error">${issue.message}</div>`;
    button.disabled = false;
    button.textContent = "Confirm stake";
  }
}
async function unstake(stakeId) {
  const accepted = await inAppDialog({ title: "Unstake crypto?", message: "Your principal will return to your available balance. Any monthly rewards already credited will remain in your Vault.", confirmLabel: "Unstake position", cancelLabel: "Keep staking" });
  if (!accepted) return;
  try {
    me = await api(`/api/earn/stakes/${encodeURIComponent(stakeId)}`, { method: "DELETE" });
    earn();
  } catch (issue) {
    showNotice(issue.message);
  }
}
let puzzleTimer = null;
let puzzleState = { deck: [], open: [], matched: [], moves: 0, seconds: 0, busy: false, started: false };
async function startPuzzle() {
  const button = document.getElementById("puzzleStartButton");
  const idleLabel = me?.earnGame?.challenge && !me.earnGame.challenge.completed && !me.earnGame.challenge.abandoned ? "Resume round" : me?.earnGame?.challenge?.completed ? "Start next level" : me?.earnGame?.challenge?.abandoned ? "Start new round" : "Start puzzle";
  if (button) { button.disabled = true; button.textContent = "Loading round…"; }
  try {
    const response = await api("/api/earn/game/start", { method: "POST", body: JSON.stringify({}) });
    me.earnGame = response.game;
    earn();
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = idleLabel; }
    showNotice(error.message);
  }
}
async function quitPuzzleRound() {
  const confirmed = await inAppDialog({
    title: "Quit this puzzle?",
    message: "Quitting forfeits this round and any reward. Your current level will stay the same.",
    confirmLabel: "Quit round",
    cancelLabel: "Keep playing",
  });
  if (!confirmed) return;
  const button = document.getElementById("puzzleQuitButton");
  if (button) { button.disabled = true; button.textContent = "Quitting…"; }
  try {
    const response = await api("/api/earn/game/quit", {
      method: "POST",
      body: JSON.stringify({ challengeId: puzzleState.challengeId }),
    });
    me = response.user;
    earn();
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Quit round"; }
    showNotice(error.message);
  }
}
function puzzleTime() {
  const elapsed = puzzleState.elapsedMs + (puzzleState.startedAt ? Date.now() - new Date(puzzleState.startedAt).getTime() : 0);
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function puzzleClockLabel() {
  if (puzzleState.started) return puzzleTime();
  return puzzleState.elapsedMs > 0 ? puzzleTime() : "Ready when you are";
}
function startPuzzleClock() {
  clearInterval(puzzleTimer);
  puzzleTimer = setInterval(() => {
    const clock = document.getElementById("puzzleClock");
    if (clock && puzzleState.started) clock.textContent = puzzleTime();
  }, 1000);
}
function renderPuzzle() {
  const board = document.getElementById("puzzleBoard");
  if (!board) return;
  board.innerHTML = puzzleState.deck.map((icon, index) => {
    const shown = puzzleState.deck[index] !== null || puzzleState.open.includes(index) || puzzleState.matched.includes(index);
    return `<button class="puzzle-tile ${shown ? "revealed" : ""} ${puzzleState.matched.includes(index) ? "matched" : ""}" onclick="flipPuzzleTile(${index})" aria-label="${shown ? icon : "Hidden tile"}" ${shown || !puzzleState.started || puzzleState.busy ? "disabled" : ""}>${shown ? icon : "?"}</button>`;
  }).join("");
  const progress = document.getElementById("puzzleProgress");
  if (progress) progress.textContent = `${puzzleState.matched.length / 2} pairs · ${puzzleState.moves} moves`;
  const clock = document.getElementById("puzzleClock");
  if (clock) clock.textContent = puzzleClockLabel();
}
async function flipPuzzleTile(index) {
  if (!puzzleState.started || puzzleState.busy || puzzleState.open.includes(index) || puzzleState.matched.includes(index)) return;
  puzzleState.busy = true;
  renderPuzzle();
  try {
    const response = await api("/api/earn/game/flip", {
      method: "POST",
      body: JSON.stringify({ challengeId: puzzleState.challengeId, index }),
    });
    me.earnGame = response.game;
    if (response.selected) {
      puzzleState.deck[index] = response.selected.symbol;
      puzzleState.open = [index];
      puzzleState.busy = false;
      renderPuzzle();
      return;
    }
    response.revealed.forEach((tile) => { puzzleState.deck[tile.index] = tile.symbol; });
    puzzleState.moves = response.game.challenge.moves;
    if (response.match) {
      puzzleState.matched = [...response.game.challenge.matchedIndices];
      puzzleState.open = [];
      puzzleState.busy = false;
      if (response.result) {
        me = response.user;
        earn();
        return;
      }
      renderPuzzle();
      return;
    }
    puzzleState.open = response.revealed.map((tile) => tile.index);
    puzzleState.busy = true;
    renderPuzzle();
    setTimeout(() => {
      puzzleState.open = [];
      puzzleState.deck = [...(me.earnGame.challenge?.visibleCards || puzzleState.deck.map((symbol, tileIndex) => puzzleState.matched.includes(tileIndex) ? symbol : null))];
      puzzleState.busy = false;
      renderPuzzle();
    }, 800);
  } catch (error) {
    puzzleState.busy = false;
    renderPuzzle();
    showNotice(error.message);
  }
}
function activity() {
  shell(
    `<header class="topbar"><div><h1>Account activity</h1><p>Your activity will appear here.</p></div><button class="primary" onclick="walletModal('receive')">Add funds</button></header><div class="card"><h3>Transaction history</h3>${transactionRows(true)}</div>`,
    "activity",
  );
  startTimeRefresh();
}
function walletModal(type) {
  const titles = {
    receive: "Receive assets",
    send: "Send assets",
    swap: "Swap assets",
  };
  const fields =
    type === "send"
      ? `<div class="send-methods" role="group" aria-label="Send destination"><button class="send-method active" id="walletMethodButton" onclick="setSendMethod('wallet')">Crypto address</button><button class="send-method" id="bankMethodButton" onclick="setSendMethod('bank')">Bank account</button></div><div class="send-fields" id="walletSendFields"><label class="field" for="address">RECIPIENT WALLET ADDRESS</label><input class="input" id="address" placeholder="0x..." autocomplete="off"></div><div class="send-fields" id="bankSendFields" hidden><div class="bank-transfer-note">Bank transfers are available for USDC only and require review before processing.</div><label class="field" for="bankCountry">COUNTRY</label><input class="input bank-input" id="bankCountry" autocomplete="country-name" placeholder="Country"><label class="field" for="accountName">ACCOUNT HOLDER NAME</label><input class="input bank-input" id="accountName" autocomplete="name" placeholder="Name on the account"><label class="field" for="bankName">BANK NAME</label><input class="input bank-input" id="bankName" autocomplete="organization" placeholder="Bank name"><label class="field" for="accountNumber">ACCOUNT NUMBER / IBAN</label><input class="input bank-input" id="accountNumber" autocomplete="off" placeholder="Account number or IBAN"><label class="field" for="bankCode">SWIFT / BIC OR ROUTING CODE</label><input class="input bank-input" id="bankCode" autocomplete="off" placeholder="Bank identifier code"></div>`
      : "";
  const receiveOptions =
    type === "receive"
      ? `<option value="BTC">BTC — Bitcoin</option><option value="ETH">ETH — Ethereum (ERC20)</option><option value="USDT">USDT — Tether (TRC20)</option><option value="USDC">USDC — USD Coin (ERC20)</option>`
      : "";
  const swapReceiveOptions = Object.keys(meta)
    .map((symbol) => `<option value="${symbol}" ${symbol === "USDC" ? "selected" : ""}>${symbol} — ${meta[symbol][1]}</option>`)
    .join("");
  const swap =
    type === "swap"
      ? `<div class="swap-trade"><div class="swap-panels"><section class="swap-panel"><div class="swap-panel-top"><span>Pay</span><span class="swap-balance">Balance <b id="swapFromBalance">0</b> <button type="button" onclick="setSwapMax()">MAX</button></span></div><div class="swap-entry"><label class="swap-token"><span class="swap-token-icon" id="swapFromIcon">₿</span><span><select id="from" aria-label="Pay asset" onchange="updateSwapQuote()">${options}</select><small id="swapFromName">Bitcoin</small></span><span class="swap-chevron">⌄</span></label><input id="amount" type="number" min="0" step="any" placeholder="0.00" oninput="updateSwapQuote()" aria-label="Amount to pay"></div></section><button type="button" class="swap-flip" onclick="flipSwapAssets()" aria-label="Switch pay and receive assets"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15l-4-4m5 12H5l4 4"/></svg></button><section class="swap-panel swap-receive"><div class="swap-panel-top"><span>Receive</span><span class="swap-balance">Balance <b id="swapToBalance">0</b></span></div><div class="swap-entry"><label class="swap-token"><span class="swap-token-icon" id="swapToIcon">$</span><span><select id="to" aria-label="Receive asset" onchange="updateSwapQuote()">${swapReceiveOptions}</select><small id="swapToName">USD Coin</small></span><span class="swap-chevron">⌄</span></label><output class="swap-estimate" id="swapEstimate">0</output></div></section></div><div class="swap-fee-card"><div><span>Swap fee</span><strong>0.5%</strong></div><p id="swapFeeLine">A lower 0.5% fee is included in your estimate.</p><small id="swapRateLine">Rates use current market prices.</small></div></div>`
      : `<label class="field">ASSET</label><select class="input" id="symbol" onchange="updateReceiveAddress(this.value)">${receiveOptions || options}</select>`;
  const receivePanel =
    type === "receive"
      ? `<div class="receive-addresses" id="receiveAddressPanel"><div class="receive-intro"><span class="eyebrow">Deposit destination</span><p>Use the matching network when sending funds to your Vault.</p></div><div class="receive-address" id="receiveAddressRow"></div></div>`
      : "";
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="modal"><div class="modal ${type === "swap" ? "swap-modal" : ""}"><div class="modal-head"><h2>${titles[type]}</h2><button class="close" onclick="modal.remove()">×</button></div><div id="modalError"></div>${fields}${swap}${receivePanel}${type === "swap" ? "" : `<label class="field" for="amount">AMOUNT</label><input class="input" id="amount" type="number" min="0" step="any" placeholder="0.00">`}<button class="primary wide" id="walletSubmitButton" onclick="submitWallet('${type}')">${type === "receive" ? "Request deposit approval" : type === "send" ? "Request send" : "Swap"}</button><p class="small" id="walletModalNote" style="margin-top:16px">${type === "receive" ? "Your request will appear in your activity and is credited only after blockchain confirmation." : type === "send" ? "Your balance is not deducted until blockchain confirmation." : "Review your estimated output before confirming."}</p></div></div>`,
  );
  if (type === "receive") updateReceiveAddress("BTC");
  if (type === "swap") updateSwapQuote();
  if (type === "send") {
    sendMethod = "wallet";
    document.querySelectorAll("#modal .send-fields input, #modal #amount").forEach((input) => input.addEventListener("input", updateSendButtonState));
    setSendMethod("wallet");
  }
}
function swapBalance(symbol) {
  return Number(me?.assets?.find((asset) => asset.symbol === symbol)?.amount || 0);
}
function updateSwapQuote() {
  const from = document.getElementById("from")?.value || "BTC";
  const to = document.getElementById("to")?.value || "USDC";
  const amount = Number(document.getElementById("amount")?.value || 0);
  const fromPrice = livePrices[from]?.usd || 0;
  const toPrice = livePrices[to]?.usd || 0;
  const estimated = amount > 0 && fromPrice && toPrice && from !== to ? amount * fromPrice * 0.995 / toPrice : 0;
  const feeUsd = amount > 0 && fromPrice ? amount * fromPrice * 0.005 : 0;
  document.getElementById("swapFromIcon").textContent = meta[from][0];
  document.getElementById("swapToIcon").textContent = meta[to][0];
  document.getElementById("swapFromName").textContent = meta[from][1];
  document.getElementById("swapToName").textContent = meta[to][1];
  document.getElementById("swapFromBalance").textContent = formatAssetAmount(swapBalance(from));
  document.getElementById("swapToBalance").textContent = formatAssetAmount(swapBalance(to));
  document.getElementById("swapEstimate").textContent = formatAssetAmount(estimated);
  document.getElementById("swapFeeLine").textContent = `0.5% fee · ${money(feeUsd)} estimated`;
  document.getElementById("swapRateLine").textContent = fromPrice && toPrice ? `1 ${from} ≈ ${formatAssetAmount(fromPrice / toPrice)} ${to} · indicative market rate` : "Rates use current market prices.";
  const button = document.getElementById("walletSubmitButton");
  const valid = amount > 0 && from !== to && amount <= swapBalance(from);
  button.disabled = !valid;
  button.title = amount > swapBalance(from) ? `Insufficient ${from} balance` : "";
}
function setSwapMax() {
  const input = document.getElementById("amount");
  input.value = swapBalance(document.getElementById("from").value);
  updateSwapQuote();
}
function flipSwapAssets() {
  const from = document.getElementById("from");
  const to = document.getElementById("to");
  [from.value, to.value] = [to.value, from.value];
  updateSwapQuote();
}
function updateSendButtonState() {
  const button = document.getElementById("walletSubmitButton");
  if (!button) return;
  const amount = Number(document.getElementById("amount")?.value);
  const requiredFields = sendMethod === "bank"
    ? ["bankCountry", "accountName", "bankName", "accountNumber", "bankCode"]
    : ["address"];
  const complete = amount > 0 && requiredFields.every((id) => document.getElementById(id)?.value.trim());
  button.disabled = !complete;
  button.style.opacity = complete ? "1" : "0.55";
  button.style.cursor = complete ? "pointer" : "not-allowed";
}
function setSendMethod(method) {
  sendMethod = method === "bank" ? "bank" : "wallet";
  const bank = sendMethod === "bank";
  document.getElementById("walletSendFields").hidden = bank;
  document.getElementById("bankSendFields").hidden = !bank;
  document.getElementById("walletMethodButton").classList.toggle("active", !bank);
  document.getElementById("bankMethodButton").classList.toggle("active", bank);
  const assetSelect = document.getElementById("symbol");
  if (assetSelect) {
    if (bank) assetSelect.value = "USDC";
    assetSelect.disabled = bank;
  }
  document.getElementById("walletSubmitButton").textContent = bank ? "Request bank transfer" : "Request send";
  document.getElementById("walletModalNote").textContent = bank
    ? "Your USDC remains in your Vault until your bank transfer is reviewed and marked sent."
    : "Your balance is not deducted until blockchain confirmation.";
  updateSendButtonState();
}
function updateReceiveAddress(symbol) {
  const panel = document.getElementById("receiveAddressPanel");
  const row = document.getElementById("receiveAddressRow");
  const address = receiveAddresses[symbol];
  if (!panel || !row || !address) return;
  panel.hidden = false;
  row.innerHTML = `<div><strong>${symbol}</strong><span>${address[0]}</span><code>${address[1]}</code></div><button class="copy-address" onclick="copyWalletAddress(this, '${address[1]}')" aria-label="Copy ${symbol} wallet address">Copy</button>`;
}
async function copyWalletAddress(button, walletAddress) {
  try {
    await navigator.clipboard.writeText(walletAddress);
    const originalText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = originalText;
    }, 1600);
  } catch {
    showNotice("Unable to copy this address. Please select it manually.", "Copy unavailable");
  }
}
async function submitWallet(type) {
  const confirmButton = document.querySelector(
    '#modal button[onclick^="submitWallet"]',
  );
  try {
    if (type === "send") {
      if (sendMethod === "bank") {
        const bankAccount = {
          country: bankCountry.value.trim(),
          accountName: accountName.value.trim(),
          bankName: bankName.value.trim(),
          accountNumber: accountNumber.value.trim(),
          bankCode: bankCode.value.trim(),
        };
        if (Object.values(bankAccount).some((value) => !value)) {
          modalError.innerHTML = '<div class="error">Complete all bank account details to continue.</div>';
          return;
        }
      } else if (!address.value.trim()) {
        modalError.innerHTML = '<div class="error">Please include a recipient address before requesting a send.</div>';
        return;
      }
    }
    const body = { amount: document.getElementById("amount").value };
    if (type === "swap") {
      body.from = document.getElementById("from").value;
      body.to = document.getElementById("to").value;
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML = '<span class="button-spinner"></span> Swapping…';
      }
    } else body.symbol = type === "send" && sendMethod === "bank" ? "USDC" : symbol.value;
    if (type === "send" && sendMethod === "bank") {
      body.destinationType = "bank";
      body.bankAccount = {
        country: bankCountry.value.trim(),
        accountName: accountName.value.trim(),
        bankName: bankName.value.trim(),
        accountNumber: accountNumber.value.trim(),
        bankCode: bankCode.value.trim(),
      };
    } else if (type === "send") {
      body.destinationType = "wallet";
      body.address = address.value.trim();
    }
    me = await api(`/api/wallet/${type}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (type === "swap" && confirmButton) {
      confirmButton.innerHTML = "✓ Swapped";
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    if (type === "receive") {
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML =
          '<span class="button-spinner"></span> Confirmed';
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    modal.remove();
    dashboard();
  } catch (error) {
    if (type === "swap" && confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = "Swap";
    }
    modalError.innerHTML = `<div class="error">${error.message}</div>`;
  }
}
async function admin() {
  try {
    const [allUsers, deposits, withdrawals, supportConversations] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/deposits"),
      api("/api/admin/withdrawals"),
      api("/api/admin/support"),
    ]);
    users = allUsers;
    const customers = users.filter((user) => user.role !== "admin");
    const rows = customers
      .map(
        (user) =>
          `<tr><td><b>${escapeHtml(user.name)}</b><div class="small">${escapeHtml(user.email)}</div></td><td>${money(portfolioValue(user.assets, livePrices, user.stakes))}</td><td><span class="status ${user.verified ? "" : "off"}">${user.verified ? "Verified" : "Pending"}</span></td><td>${escapeHtml(user.createdAt)}</td><td><div class="admin-account-actions"><button class="edit" onclick="editUser('${user.id}')">Manage</button><button class="action award-bonus-action" onclick="openBonusModal('${user.id}')">Award bonus</button></div></td></tr>`,
      )
      .join("");
    shell(
      `<header class="topbar"><div><h1>Admin console</h1><p>Updates are applied only to the account you select.</p></div><div class="profile"><div class="avatar">${initials(me.name)}</div>${me.name}</div></header>${adminSupportInbox(supportConversations)}${pendingDeposits(deposits)}${pendingWithdrawals(withdrawals)}<div class="card"><h3>All customer accounts <span class="small">(${customers.length})</span></h3><div style="overflow:auto"><table class="admin-table"><thead><tr><th>User</th><th>Portfolio</th><th>Status</th><th>Joined</th><th>Account actions</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="small">No customer accounts yet.</td></tr>'}</tbody></table></div></div>`,
      "admin",
    );
  } catch {
    dashboard();
  }
}
function adminSupportInbox(conversations) {
  const unread = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  const rows = conversations.length
    ? conversations.map((conversation) => {
      const preview = conversation.lastMessage?.text || "No messages yet";
      const updated = new Date(conversation.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return `<article class="support-inbox-row"><div class="support-inbox-person"><span class="support-avatar">${escapeHtml(initials(conversation.user.name))}</span><div><b>${escapeHtml(conversation.user.name)}</b><span>${escapeHtml(conversation.user.email)} · ${escapeHtml(updated)}</span></div></div><p>${escapeHtml(preview)}</p><button class="outline" onclick="openAdminSupport('${conversation.id}')">${conversation.unreadCount ? `<span class="inbox-unread">${conversation.unreadCount} new</span>` : "Open chat"} <span aria-hidden="true">→</span></button></article>`;
    }).join("")
    : '<p class="support-inbox-empty">No support conversations yet. New customer messages will appear here.</p>';
  return `<section class="card support-inbox" id="adminSupportInbox"><div class="support-inbox-heading"><div><div class="eyebrow">Customer care</div><h3>Support inbox ${unread ? `<span class="support-count">${unread} unread</span>` : ""}</h3></div><span class="small">${conversations.length} conversation${conversations.length === 1 ? "" : "s"}</span></div><div class="support-inbox-list">${rows}</div></section>`;
}
async function refreshAdminSupportInbox() {
  if (!document.getElementById("adminSupportInbox")) return;
  try {
    const conversations = await api("/api/admin/support");
    const inbox = document.getElementById("adminSupportInbox");
    if (inbox) inbox.outerHTML = adminSupportInbox(conversations);
    refreshSupportBadges();
  } catch {}
}
async function openAdminSupport(id) {
  adminSupportConversationId = id;
  try {
    const response = await api(`/api/admin/support/${encodeURIComponent(id)}`);
    document.getElementById("adminSupportModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-bg support-admin-fullscreen-bg" id="adminSupportModal"><section class="modal support-admin-modal support-admin-fullscreen" role="dialog" aria-modal="true" aria-labelledby="adminSupportTitle"><header class="support-screen-header"><button class="support-back" type="button" onclick="closeAdminSupport()" aria-label="Back to support inbox"><span aria-hidden="true">←</span><span>Inbox</span></button><span class="support-agent-avatar" aria-hidden="true">${escapeHtml(initials(response.user.name))}</span><div class="support-agent-copy"><b id="adminSupportTitle">${escapeHtml(response.user.name)}</b><span>${escapeHtml(response.user.email)} · Customer conversation</span></div><span class="support-status"><span></span>Private chat</span></header><div class="support-messages admin-support-messages" id="adminSupportMessages" aria-live="polite"></div><form class="support-composer support-screen-composer" onsubmit="sendAdminSupportReply(event)"><label class="sr-only" for="adminSupportReply">Reply to customer</label><textarea id="adminSupportReply" maxlength="2000" rows="1" placeholder="Write a reply…" required></textarea><div class="support-composer-footer"><span>Messages are automatically cleared after 24 hours. Never request passwords or recovery phrases.</span><button class="primary" id="adminSupportSend" type="submit" disabled>Send reply <span aria-hidden="true">↗</span></button></div></form></section></div>`);
    renderSupportMessages("adminSupportMessages", response.conversation.messages, "admin", true);
    configureSupportComposer("adminSupportReply", "adminSupportSend");
    refreshSupportBadges();
    if (adminSupportChatTimer) clearInterval(adminSupportChatTimer);
    adminSupportChatTimer = setInterval(refreshAdminSupportChat, 8000);
    refreshAdminSupportInbox();
  } catch (error) {
    showNotice(error.message);
  }
}
async function refreshAdminSupportChat() {
  if (!adminSupportConversationId || !document.getElementById("adminSupportMessages")) return;
  try {
    const response = await api(`/api/admin/support/${encodeURIComponent(adminSupportConversationId)}`);
    renderSupportMessages("adminSupportMessages", response.conversation.messages, "admin");
    refreshSupportBadges();
  } catch {}
}
function closeAdminSupport() {
  document.getElementById("adminSupportModal")?.remove();
  adminSupportConversationId = null;
  if (adminSupportChatTimer) clearInterval(adminSupportChatTimer);
  adminSupportChatTimer = null;
}
async function sendAdminSupportReply(event) {
  event.preventDefault();
  if (!adminSupportConversationId) return;
  const input = document.getElementById("adminSupportReply");
  const button = document.getElementById("adminSupportSend");
  const text = input.value.trim();
  if (!text) return;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const response = await api(`/api/admin/support/${encodeURIComponent(adminSupportConversationId)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    input.value = "";
    renderSupportMessages("adminSupportMessages", response.conversation.messages, "admin", true);
    const conversations = await api("/api/admin/support");
    const inbox = document.getElementById("adminSupportInbox");
    if (inbox) inbox.outerHTML = adminSupportInbox(conversations);
    refreshSupportBadges();
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = !input.value.trim();
    button.innerHTML = 'Send reply <span aria-hidden="true">↗</span>';
    input.focus();
  }
}
function pendingDeposits(deposits) {
  const pending = deposits.filter((item) => item.status === "pending");
  if (!pending.length)
    return '<div class="card" style="margin-bottom:18px"><h3>Pending deposit requests</h3><p class="small">No requests awaiting approval.</p></div>';
  return `<div class="card" style="margin-bottom:18px"><h3>Pending deposit requests <span class="small">(${pending.length})</span></h3>${pending.map((item) => `<div class="tx"><div class="tx-left"><span class="token ${meta[item.symbol][2]}">${meta[item.symbol][0]}</span><div><b>${item.user.name}</b><div class="small">${item.user.email} · ${item.symbol} ${item.amount}</div></div></div><div class="actions" style="margin:0"><button class="action" onclick="processDeposit('${item.id}','approve')">Approve</button><button class="action secondary" onclick="processDeposit('${item.id}','cancel')">Cancel</button></div></div>`).join("")}</div>`;
}
async function processDeposit(id, action) {
  try {
    await api(`/api/admin/deposits/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
function pendingWithdrawals(withdrawals) {
  const pending = withdrawals.filter((item) => item.status === "pending");
  if (!pending.length)
    return '<div class="card" style="margin-bottom:18px"><h3>Pending send requests</h3><p class="small">No sends awaiting approval.</p></div>';
  return `<div class="card" style="margin-bottom:18px"><h3>Pending send requests <span class="small">(${pending.length})</span></h3>${pending.map((item) => {
    const bankTransfer = item.destinationType === "bank" && item.bankAccount;
    const destination = bankTransfer
      ? `<div class="bank-request-details"><b>Bank account · ${escapeHtml(item.bankAccount.country)}</b><span>${escapeHtml(item.bankAccount.accountName)} · ${escapeHtml(item.bankAccount.bankName)}</span><span>Account: ${escapeHtml(item.bankAccount.accountNumber)}</span><span>Bank code: ${escapeHtml(item.bankAccount.bankCode)}</span></div>`
      : `<div class="small">${item.symbol} ${item.amount} → ${escapeHtml(item.address || "")}</div>`;
    return `<div class="tx"><div class="tx-left"><span class="token ${meta[item.symbol]?.[2] || ""}">${meta[item.symbol]?.[0] || "•"}</span><div><b>${escapeHtml(item.user?.name)} · ${item.symbol} ${item.amount}</b>${destination}</div></div><div class="actions" style="margin:0"><button class="action" onclick="processWithdrawal('${item.id}','approve')">${bankTransfer ? "Mark sent" : "Approve"}</button><button class="action secondary" onclick="processWithdrawal('${item.id}','cancel')">Cancel</button></div></div>`;
  }).join("")}</div>`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
async function processWithdrawal(id, action) {
  try {
    await api(`/api/admin/withdrawals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
function editUser(id) {
  const user = users.find((item) => item.id === id);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="modal"><div class="modal"><div class="modal-head"><h2>Manage account</h2><button class="close" onclick="modal.remove()">×</button></div><label class="field">NAME</label><input class="input" id="editName" value="${user.name}"><label class="field">EMAIL</label><input class="input" id="editEmail" value="${user.email}"><div class="form-row"><div><label class="field">CURRENT PORTFOLIO</label><div class="input" style="color:#bfc6d6">${money(portfolioValue(user.assets, livePrices, user.stakes))}</div></div><div><label class="field">MONTHLY CHANGE (%)</label><input class="input" id="editChange" type="number" value="${user.change}"></div></div><label class="field">ADD FUNDS (USDC)</label><input class="input" id="adminCredit" type="number" min="0" step="0.01" placeholder="Enter an amount to add"><label class="field">WITHDRAW FUNDS (USDC)</label><input class="input" id="adminWithdrawal" type="number" min="0" step="0.01" placeholder="Enter an amount to remove"><label class="field">MINIMUM BALANCE TO WITHDRAW (USD)</label><input class="input" id="editWithdrawalLimit" type="number" min="0" step="0.01" value="${user.withdrawalLimit ?? ""}" placeholder="Leave blank to remove limit"><div class="small" style="margin-top:7px">Users cannot withdraw unless their total portfolio reaches this minimum balance. Leave blank or zero to remove it.</div><label class="field">VERIFICATION</label><select class="input" id="editVerified"><option value="true" ${user.verified ? "selected" : ""}>Verified</option><option value="false" ${!user.verified ? "selected" : ""}>Pending</option></select><button class="primary wide" onclick="saveUser('${id}')">Save changes</button><button class="danger wide" onclick="deleteUser('${id}')">Delete account</button></div></div>`,
  );
}
function openBonusModal(id) {
  const user = users.find((item) => item.id === id);
  if (!user) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="bonusModal"><div class="modal admin-bonus-modal"><div class="modal-head"><h2>Award bonus</h2><button class="close" onclick="document.getElementById('bonusModal').remove()">×</button></div><p class="small bonus-recipient">Bonus for <strong>${escapeHtml(user.name)}</strong> · ${escapeHtml(user.email)}</p><label class="field" for="bonusAmount">BONUS AMOUNT (USDC)</label><input class="input" id="bonusAmount" type="number" min="0.01" max="1000000" step="0.01" placeholder="Enter amount"><label class="field" for="bonusReason">REASON</label><textarea class="input" id="bonusReason" maxlength="250" placeholder="Explain why this bonus is being awarded"></textarea><div class="small field-help">The reason is saved in the customer's transaction history.</div><button class="primary wide" id="awardBonusButton" onclick="awardBonus('${id}')">Award bonus</button></div></div>`,
  );
}
async function awardBonus(id) {
  const amount = Number(document.getElementById("bonusAmount")?.value);
  const reason = document.getElementById("bonusReason")?.value.trim() || "";
  const button = document.getElementById("awardBonusButton");
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1000000) return showNotice("Enter a bonus amount between $0.01 and $1,000,000.");
  if (reason.length < 3 || reason.length > 250) return showNotice("Enter a reason between 3 and 250 characters.");
  button.disabled = true;
  button.textContent = "Awarding…";
  try {
    await api(`/api/admin/users/${id}/bonus`, {
      method: "POST",
      body: JSON.stringify({ amount, reason }),
    });
    document.getElementById("bonusModal")?.remove();
    showNotice("Bonus awarded successfully.");
    admin();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Award bonus";
    showNotice(error.message);
  }
}
async function saveUser(id) {
  try {
    const parsedLimit = document.getElementById("editWithdrawalLimit").value;
    await api(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editName.value,
        email: editEmail.value,
        change: editChange.value,
        verified: editVerified.value === "true",
        withdrawalLimit: parsedLimit === "" ? null : Number(parsedLimit),
      }),
    });
    const credit = Number(document.getElementById("adminCredit").value);
    const withdrawal = Number(document.getElementById("adminWithdrawal").value);
    if (credit > 0)
      await api(`/api/admin/users/${id}/funds`, {
        method: "POST",
        body: JSON.stringify({ amount: credit }),
      });
    if (withdrawal > 0)
      await api(`/api/admin/users/${id}/adjustment`, {
        method: "POST",
        body: JSON.stringify({ amount: -withdrawal }),
      });
    modal.remove();
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
async function deleteUser(id) {
  const user = users.find((item) => item.id === id);
  if (!user || !(await confirmInApp(`Delete ${user.name}'s account permanently?`, "Delete account?"))) return;
  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    modal.remove();
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
function confirmSignOut() {
  return new Promise((resolve) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="modal-bg" id="confirmModal"><div class="modal confirm-modal"><div class="modal-head"><h2>Sign out?</h2><button class="close" onclick="resolveSignOut(false)">×</button></div><p class="confirm-copy">Your session will be ended on this device.</p><div class="confirm-actions"><button class="action secondary" onclick="resolveSignOut(false)">Stay signed in</button><button class="primary" onclick="resolveSignOut(true)">Sign out</button></div></div></div>`,
    );
    window.resolveSignOut = (confirmed) => {
      document.getElementById("confirmModal")?.remove();
      delete window.resolveSignOut;
      resolve(confirmed);
    };
  });
}
async function logout() {
  if (!(await confirmSignOut())) return;
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  clearLocalSession();
  landing();
}
async function boot() {
  if (!token) return landing();
  if (checkIdleSession()) return;
  try {
    me = await api("/api/me");
    dashboard();
  } catch {
    clearLocalSession();
    landing();
  }
}
boot();
