// Set this to the published .dmg once there is one; every "Download" link uses it.
const DOWNLOAD_URL = "";

if (DOWNLOAD_URL) {
  document.querySelectorAll("[data-download]").forEach((a) => {
    a.href = DOWNLOAD_URL;
  });
}

// Mobile waitlist. nginx proxies this to the waitlist container (waitlist/),
// which stores the address in Postgres. Set it to "" to close the waitlist;
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
      say("The waitlist isn't open yet. Check back soon.", "err");
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
        say("You're on the list. We'll email you once when it ships.", "ok");
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
