// Download links point at the latest GitHub release. The page link works on its
// own; once the GitHub API answers we swap in the installer itself so the click
// downloads straight away.
//   data-download             the visitor's own OS (label and icon follow it)
//   data-download="windows"   a specific OS: mac, windows or linux
// Elements with data-alt="<os>" are hidden for the visitor's own OS, so the
// "Also for ..." note only lists the others.
const RELEASES_REPO = "gettrekapp/trek";
const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases/latest`;

const ua = navigator.userAgent.toLowerCase();
const uaPlatform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
const linuxArch = /aarch64|arm64|armv8/.test(ua + uaPlatform) ? "arm64" : "x64";
const visitorOS = /android|iphone|ipad|ipod/.test(ua)
  ? "mac"
  : uaPlatform.includes("win") || ua.includes("windows")
    ? "windows"
    : uaPlatform.includes("linux") || ua.includes("linux") || ua.includes("x11")
      ? "linux"
      : "mac";

const PLATFORMS = {
  mac: { label: "macOS", icon: "#i-apple", match: (n) => n.endsWith(".dmg") },
  windows: { label: "Windows", icon: "#i-windows", match: (n) => /-win-x64\.exe$/.test(n) },
  linux: { label: "Linux", icon: "#i-linux", match: (n) => n.endsWith(`-linux-${linuxArch}.deb`) },
};

const downloadLinks = [...document.querySelectorAll("[data-download]")].map((a) => {
  const os = a.dataset.download || visitorOS;
  a.href = RELEASES_URL;
  const use = a.querySelector("svg use");
  if (use && !a.dataset.download) {
    use.setAttribute("href", PLATFORMS[os].icon);
    const text = [...a.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (text) text.textContent = `Download for ${PLATFORMS[os].label}\n    `;
  }
  return { a, os };
});

document.querySelectorAll("[data-alt]").forEach((el) => {
  el.hidden = el.dataset.alt === visitorOS;
});

if (downloadLinks.length) {
  fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((release) => {
      const assets = release?.assets || [];
      downloadLinks.forEach(({ a, os }) => {
        const asset = assets.find((x) => PLATFORMS[os].match(x.name));
        if (asset) a.href = asset.browser_download_url;
      });
    })
    .catch(() => {});
}

// Android beta sign-up. nginx proxies this to the waitlist container (waitlist/),
// which stores the address in Postgres. Set it to "" to close sign-ups;
// the form then says so instead of pretending to save the address.
const WAITLIST_URL = "/api/waitlist";

const waitlist = document.querySelector("[data-waitlist]");
if (waitlist) {
  const status = waitlist.querySelector("[data-waitlist-status]");
  const button = waitlist.querySelector("button[type=submit]");
  const email = waitlist.querySelector("input[name=email]");
  const say = (text, kind) => {
    status.textContent = text;
    status.classList.toggle("ok", kind === "ok");
    status.classList.toggle("err", kind === "err");
  };

  waitlist.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!email.checkValidity()) {
      say("Enter a valid email address.", "err");
      email.focus();
      return;
    }
    if (!WAITLIST_URL) {
      say("The beta isn't open yet. Check back soon.", "err");
      return;
    }
    button.disabled = true;
    say("Saving…");
    try {
      const res = await fetch(WAITLIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(waitlist))),
      });
      if (res.ok) {
        waitlist.classList.add("done");
        say("You're in. We'll email your invite to the Android beta soon.", "ok");
        return;
      }
      button.disabled = false;
      if (res.status === 429) {
        say("Too many tries. Wait a minute and try again.", "err");
        return;
      }
      const body = await res.json().catch(() => ({}));
      say(res.status === 400 && body.error ? body.error : "That didn't go through. Try again in a moment.", "err");
    } catch {
      button.disabled = false;
      say("That didn't go through. Try again in a moment.", "err");
    }
  });
}

// Copy buttons
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Press ⌘C";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
});

// Header border once scrolled
const header = document.querySelector(".site-header");
const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Reveal on scroll
const els = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
  );
  els.forEach((el) => io.observe(el));
} else {
  els.forEach((el) => el.classList.add("in"));
}
