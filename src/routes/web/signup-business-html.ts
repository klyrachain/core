/**
 * Single-page Typeform-style business signup (steps 1–4: identity, entity, intent, profile + optional passkey).
 */

export function signupBusinessPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Business signup — Klyra</title>
  <style>
    :root {
      --bg: #0c0c0f;
      --surface: #16161d;
      --text: #f4f4f8;
      --muted: #9898a8;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --error: #f87171;
      --radius: 12px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap {
      max-width: 520px;
      margin: 0 auto;
      padding: 2rem 1.25rem 4rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .progress {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
    }
    .progress span {
      flex: 1;
      height: 4px;
      background: var(--surface);
      border-radius: 2px;
      transition: background 0.2s;
    }
    .progress span.active { background: var(--accent); }
    h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      letter-spacing: -0.02em;
    }
    .sub {
      color: var(--muted);
      margin: 0 0 2rem;
      font-size: 1rem;
    }
    section[hidden] { display: none !important; }
    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      color: var(--muted);
    }
    input, select {
      width: 100%;
      padding: 0.875rem 1rem;
      font-size: 1rem;
      border: 1px solid #2a2a35;
      border-radius: var(--radius);
      background: var(--surface);
      color: var(--text);
      margin-bottom: 1.25rem;
    }
    input:focus, select:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    button {
      padding: 0.875rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      background: var(--accent);
      color: #fff;
    }
    button:hover { background: var(--accent-hover); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button.secondary {
      background: transparent;
      color: var(--muted);
      border: 1px solid #2a2a35;
    }
    button.secondary:hover { color: var(--text); border-color: var(--muted); }
    button.linkish {
      background: transparent;
      color: var(--accent);
      padding: 0.5rem 0;
      text-decoration: underline;
      font-weight: 500;
    }
    .error {
      color: var(--error);
      font-size: 0.875rem;
      margin: -0.5rem 0 1rem;
    }
    .success-banner {
      padding: 1rem;
      background: var(--surface);
      border-radius: var(--radius);
      margin-bottom: 1.5rem;
      border-left: 4px solid var(--accent);
    }
    .divider {
      text-align: center;
      color: var(--muted);
      font-size: 0.8rem;
      margin: 1rem 0;
    }
    .hint { font-size: 0.8rem; color: var(--muted); margin-top: -0.75rem; margin-bottom: 1rem; }
    h2.section-title { font-size: 1.125rem; font-weight: 600; margin: 1.75rem 0 0.5rem; }
    .passkey-block { margin-top: 0.5rem; padding-top: 1rem; border-top: 1px solid #2a2a35; }
    .saved-note { color: var(--accent); font-size: 0.9rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <a href="#step-main" class="skip" style="position:absolute;left:-9999px">Skip to form</a>
  <main id="step-main" class="wrap">
    <div class="progress" role="progressbar" aria-valuenow="1" aria-valuemin="1" aria-valuemax="4" aria-label="Signup progress" id="progress-bar">
      <span class="active" aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </div>

    <section id="step1" aria-labelledby="t1">
      <h1 id="t1">Sign in with your work email</h1>
      <p class="sub">We use your email domain to understand your company—no extra typing required.</p>
      <div id="err1" class="error" role="alert" aria-live="polite"></div>
      <form id="form-email" autocomplete="on">
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" required autocomplete="email" inputmode="email" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" minlength="10" autocomplete="new-password" aria-describedby="pw-hint" />
        <p id="pw-hint" class="hint">At least 10 characters. Or use Google or a magic link below.</p>
        <div class="actions">
          <button type="submit">Continue</button>
        </div>
      </form>
      <p class="divider">or</p>
      <div class="actions">
        <button type="button" class="secondary" id="btn-google">Continue with Google</button>
      </div>
      <p class="divider">or</p>
      <form id="form-magic">
        <button type="submit" class="linkish" id="btn-magic">Email me a magic link instead</button>
      </form>
    </section>

    <section id="step2" hidden aria-labelledby="t2">
      <h1 id="t2">What are we building for?</h1>
      <p class="sub">Tell us about your business.</p>
      <div id="err2" class="error" role="alert" aria-live="polite"></div>
      <form id="form-entity">
        <label for="companyName">Company name</label>
        <input id="companyName" name="companyName" type="text" required minlength="2" maxlength="200" autocomplete="organization" />
        <label for="website">Company website <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <input id="website" name="website" type="url" inputmode="url" placeholder="https://example.com" maxlength="500" autocomplete="url" />
        <div class="actions">
          <button type="button" class="secondary" id="back2">Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </section>

    <section id="step3" hidden aria-labelledby="t3">
      <h1 id="t3">Customize your experience</h1>
      <p class="sub">How do you plan to use the platform?</p>
      <div id="err3" class="error" role="alert" aria-live="polite"></div>
      <form id="form-intent">
        <label for="signupRole">Your role</label>
        <select id="signupRole" name="signupRole" required>
          <option value="">Choose one</option>
          <option value="DEVELOPER">Developer</option>
          <option value="FOUNDER_EXECUTIVE">Founder / Executive</option>
          <option value="FINANCE_OPS">Finance / Ops</option>
          <option value="PRODUCT">Product</option>
        </select>
        <label for="primaryGoal">Primary goal</label>
        <select id="primaryGoal" name="primaryGoal" required>
          <option value="">Choose one</option>
          <option value="ACCEPT_PAYMENTS">Accept payments</option>
          <option value="SEND_PAYOUTS">Send payouts</option>
          <option value="INTEGRATE_SDK">Integrate the SDK</option>
          <option value="EXPLORING">Just exploring</option>
        </select>
        <div class="actions">
          <button type="button" class="secondary" id="back3">Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </section>

    <section id="step4" hidden aria-labelledby="t-profile">
      <h1 id="t-profile">Set up your profile</h1>
      <p class="sub">Name and password secure your account.</p>
      <div id="err4" class="error" role="alert" aria-live="polite"></div>
      <div id="profile-form-block">
        <form id="form-profile">
          <label for="profileName">Your name</label>
          <input id="profileName" name="profileName" type="text" required minlength="2" maxlength="120" autocomplete="name" />
          <label for="profilePassword" id="lbl-profile-password">Password</label>
          <input id="profilePassword" name="profilePassword" type="password" autocomplete="new-password" aria-describedby="profile-pw-hint" />
          <p id="profile-pw-hint" class="hint"></p>
          <div class="actions">
            <button type="button" class="secondary" id="back4">Back</button>
            <button type="submit">Save profile</button>
          </div>
        </form>
      </div>
      <p id="profile-saved-note" class="saved-note" hidden>Profile saved.</p>
      <div id="passkey-block" class="passkey-block" hidden>
        <h2 class="section-title" id="t-passkey">Passkey <span style="font-weight:400;color:var(--muted)">(optional)</span></h2>
        <p class="sub" style="margin-bottom:1rem">Use Face ID, Touch ID, or a security key for faster sign-in next time.</p>
        <label for="passkeyFriendlyName">Passkey name</label>
        <input id="passkeyFriendlyName" type="text" placeholder="e.g. MacBook, iPhone" maxlength="80" autocomplete="off" />
        <div class="actions" style="margin-top:0.75rem">
          <button type="button" class="secondary" id="btn-add-passkey">Add passkey</button>
          <button type="button" id="btn-enter-dashboard">Enter sandbox</button>
        </div>
        <p id="passkey-status" class="hint" role="status"></p>
      </div>
    </section>

    <section id="step-done" hidden aria-labelledby="t4">
      <h1 id="t4">You are in</h1>
      <div class="success-banner">
        <p style="margin:0 0 0.5rem"><strong>Sandbox mode</strong> — explore safely. Legal and financial details are collected only when you go live or connect payouts.</p>
        <p style="margin:0;font-size:0.9rem;color:var(--muted)" id="landing-msg"></p>
      </div>
      <p class="sub" id="token-store-hint" style="font-size:0.85rem">Save your session: your dashboard client should store the Bearer token from the last response.</p>
    </section>
  </main>
  <script>
(function () {
  const API = "";
  let token = sessionStorage.getItem("bp_token") || "";
  let landingHint = "dashboard_overview";

  function headers() {
    const h = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  function setStep(n) {
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById("step" + i);
      if (el) el.hidden = i !== n;
    }
    document.getElementById("step4").hidden = n !== 4;
    document.getElementById("step-done").hidden = true;
    const bar = document.querySelectorAll(".progress span");
    bar.forEach((s, i) => s.classList.toggle("active", i < n));
    document.getElementById("progress-bar").setAttribute("aria-valuenow", String(n));
  }

  function configureProfileStep(d) {
    document.getElementById("profileName").value = d.portalDisplayName || "";
    const pw = document.getElementById("profilePassword");
    const lbl = document.getElementById("lbl-profile-password");
    const hint = document.getElementById("profile-pw-hint");
    document.getElementById("profile-form-block").hidden = false;
    document.getElementById("profile-saved-note").hidden = true;
    document.getElementById("passkey-block").hidden = true;
    document.getElementById("err4").textContent = "";
    if (d.hasPassword) {
      lbl.textContent = "New password (optional)";
      pw.removeAttribute("required");
      pw.value = "";
      hint.textContent = "Leave blank to keep your current password. At least 10 characters if you change it.";
    } else {
      lbl.textContent = "Password";
      pw.setAttribute("required", "required");
      pw.value = "";
      hint.textContent = "At least 10 characters — secures your account alongside your verified email.";
    }
  }

  function showDone(payload) {
    document.getElementById("step1").hidden = true;
    document.getElementById("step2").hidden = true;
    document.getElementById("step3").hidden = true;
    document.getElementById("step4").hidden = true;
    document.getElementById("step-done").hidden = false;
    document.querySelector(".progress").style.display = "none";
    const lh = payload.landingHint || landingHint;
    const hints = {
      docs_sdk_sandbox: "Next: open API docs and create sandbox keys.",
      dashboard_payments_flow: "Next: explore the payment flow and pricing in the dashboard.",
      dashboard_payouts: "Next: review payout options in the dashboard.",
      docs_api_overview: "Next: browse the API overview and examples.",
      dashboard_overview: "Next: explore the dashboard."
    };
    document.getElementById("landing-msg").textContent = hints[lh] || hints.dashboard_overview;
    if (payload.accessToken) {
      token = payload.accessToken;
      sessionStorage.setItem("bp_token", token);
    }
  }

  async function afterAuth() {
    const res = await fetch(API + "/api/business-auth/session", { headers: headers() });
    const data = await res.json().catch(function () { return {}; });
    if (!data.success || !data.data) {
      setStep(1);
      return;
    }
    const d = data.data;
    if (d.businesses && d.businesses.length > 0) {
      if (d.profileComplete) {
        showDone({ landingHint: "dashboard_overview", accessToken: token });
      } else {
        configureProfileStep(d);
        setStep(4);
      }
      return;
    }
    if (d.onboarding && d.onboarding.companyName) {
      document.getElementById("companyName").value = d.onboarding.companyName || "";
      document.getElementById("website").value = d.onboarding.website || "";
      setStep(3);
      return;
    }
    setStep(2);
  }

  function qs(name) {
    const u = new URL(location.href);
    return u.searchParams.get(name);
  }

  (async function init() {
    const portal = qs("portal_token");
    const magic = qs("magic");
    const err = qs("error");
    if (err) {
      document.getElementById("err1").textContent =
        err === "email_not_verified" ? "Google email must be verified." : "Sign-in failed. Try again.";
    }
    if (portal) {
      token = portal;
      sessionStorage.setItem("bp_token", token);
      history.replaceState({}, "", location.pathname);
      await afterAuth();
      return;
    }
    if (magic) {
      try {
        const res = await fetch(API + "/api/business-auth/magic-link/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: magic }),
        });
        const data = await res.json();
        if (data.success && data.data && data.data.accessToken) {
          token = data.data.accessToken;
          sessionStorage.setItem("bp_token", token);
          history.replaceState({}, "", location.pathname);
          await afterAuth();
          return;
        }
        document.getElementById("err1").textContent = data.error || "Magic link expired.";
      } catch (e) {
        document.getElementById("err1").textContent = "Could not verify link.";
      }
      return;
    }
    if (token) await afterAuth();
  })();

  document.getElementById("form-email").addEventListener("submit", async function (e) {
    e.preventDefault();
    document.getElementById("err1").textContent = "";
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (password.length < 10) {
      document.getElementById("err1").textContent = "Password must be at least 10 characters, or use Google / magic link.";
      return;
    }
    try {
      const res = await fetch(API + "/api/business-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password }),
      });
      const data = await res.json();
      if (!data.success) {
        document.getElementById("err1").textContent = data.error || "Registration failed.";
        return;
      }
      token = data.data.accessToken;
      sessionStorage.setItem("bp_token", token);
      setStep(2);
    } catch (err) {
      document.getElementById("err1").textContent = "Network error.";
    }
  });

  document.getElementById("btn-google").addEventListener("click", async function () {
    const res = await fetch(API + "/api/business-auth/config");
    const data = await res.json().catch(function () { return {}; });
    if (!data.success || !data.data || !data.data.googleEnabled) {
      document.getElementById("err1").textContent = "Google sign-in is not configured on this server.";
      return;
    }
    location.href = API + "/api/business-auth/google/start";
  });

  document.getElementById("form-magic").addEventListener("submit", async function (e) {
    e.preventDefault();
    document.getElementById("err1").textContent = "";
    const email = document.getElementById("email").value.trim();
    if (!email) {
      document.getElementById("err1").textContent = "Enter your work email first.";
      return;
    }
    try {
      const res = await fetch(API + "/api/business-auth/magic-link/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      const data = await res.json();
      const msg = data.data && data.data.message ? data.data.message : (data.error || "Could not send.");
      if (data.data && data.data.devMagicUrl) {
        document.getElementById("err1").innerHTML =
          msg + " Dev link: <a href=\\"" + data.data.devMagicUrl + "\\" style=color:var(--accent)>open</a>";
      } else {
        document.getElementById("err1").textContent = msg;
        document.getElementById("err1").style.color = data.data && data.data.emailSent ? "var(--muted)" : "var(--error)";
      }
    } catch (err) {
      document.getElementById("err1").textContent = "Network error.";
    }
  });

  document.getElementById("form-entity").addEventListener("submit", async function (e) {
    e.preventDefault();
    document.getElementById("err2").textContent = "";
    try {
      const res = await fetch(API + "/api/business-auth/onboarding/entity", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          companyName: document.getElementById("companyName").value.trim(),
          website: document.getElementById("website").value.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        document.getElementById("err2").textContent = data.error || "Failed.";
        return;
      }
      setStep(3);
    } catch (err) {
      document.getElementById("err2").textContent = "Network error.";
    }
  });

  document.getElementById("form-intent").addEventListener("submit", async function (e) {
    e.preventDefault();
    document.getElementById("err3").textContent = "";
    try {
      const res = await fetch(API + "/api/business-auth/onboarding/complete", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          signupRole: document.getElementById("signupRole").value,
          primaryGoal: document.getElementById("primaryGoal").value,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        document.getElementById("err3").textContent = data.error || "Failed.";
        return;
      }
      if (data.data.accessToken) {
        token = data.data.accessToken;
        sessionStorage.setItem("bp_token", token);
      }
      landingHint = data.data.landingHint || "dashboard_overview";
      const sres = await fetch(API + "/api/business-auth/session", { headers: headers() });
      const sdata = await sres.json().catch(function () { return {}; });
      if (sdata.success && sdata.data) {
        configureProfileStep(sdata.data);
      }
      setStep(4);
    } catch (err) {
      document.getElementById("err3").textContent = "Network error.";
    }
  });

  document.getElementById("form-profile").addEventListener("submit", async function (e) {
    e.preventDefault();
    document.getElementById("err4").textContent = "";
    const name = document.getElementById("profileName").value.trim();
    const pw = document.getElementById("profilePassword").value;
    const body = { displayName: name };
    if (pw.length > 0) body.password = pw;
    try {
      const res = await fetch(API + "/api/business-auth/profile/setup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        document.getElementById("err4").textContent = data.error || "Could not save profile.";
        return;
      }
      document.getElementById("profile-form-block").hidden = true;
      document.getElementById("profile-saved-note").hidden = false;
      document.getElementById("passkey-block").hidden = false;
      document.getElementById("passkey-status").textContent = "";
    } catch (err) {
      document.getElementById("err4").textContent = "Network error.";
    }
  });

  document.getElementById("btn-enter-dashboard").addEventListener("click", function () {
    showDone({ landingHint: landingHint, accessToken: token });
  });

  document.getElementById("btn-add-passkey").addEventListener("click", async function () {
    document.getElementById("passkey-status").textContent = "";
    document.getElementById("err4").textContent = "";
    try {
      const optRes = await fetch(API + "/api/business-auth/passkey/registration-options", {
        headers: headers(),
      });
      const optData = await optRes.json();
      if (!optData.success || !optData.data || !optData.data.options) {
        document.getElementById("passkey-status").textContent =
          optData.error || "Passkey is not available. Check BUSINESS_WEBAUTHN_RP_ID and origins.";
        return;
      }
      const mod = await import("https://esm.sh/@simplewebauthn/browser@13.2.2");
      const attResp = await mod.startRegistration({
        optionsJSON: optData.data.options,
      });
      const friendly = document.getElementById("passkeyFriendlyName").value.trim() || undefined;
      const verRes = await fetch(API + "/api/business-auth/passkey/register", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ response: attResp, passkeyName: friendly }),
      });
      const verData = await verRes.json();
      if (!verData.success) {
        document.getElementById("passkey-status").textContent = verData.error || "Passkey registration failed.";
        return;
      }
      document.getElementById("passkey-status").textContent = "Passkey added. You can sign in with it next time.";
    } catch (err) {
      document.getElementById("passkey-status").textContent =
        err && err.name === "NotAllowedError" ? "Passkey was cancelled." : "Passkey setup failed.";
    }
  });

  document.getElementById("back2").addEventListener("click", function () {
    setStep(1);
  });
  document.getElementById("back3").addEventListener("click", function () {
    setStep(2);
  });
  document.getElementById("back4").addEventListener("click", function () {
    setStep(3);
  });
})();
  </script>
</body>
</html>`;
}
