/* Supabase backend + login. Exposes the same window.claude.use("db" | "user") contract the planner expects. */
(function () {
  var CFG = window.PLANNER_CONFIG || {};
  var configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_URL.indexOf("YOUR-") < 0;
  var sb = null, me = null, profile = { is_owner: false }, ready;
  var resolveReady; ready = new Promise(function (r) { resolveReady = r; });

  /* ---------- login screen ---------- */
  var css = document.createElement("style");
  css.textContent =
    "#auth{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--ink);font-family:var(--font-body)}" +
    "#auth form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}" +
    "#auth h1{font-family:var(--font-display);font-size:30px;margin:0 0 4px}" +
    "#auth p{margin:0;color:var(--muted);font-size:14px;line-height:1.4}" +
    "#auth input{font:inherit;font-size:16px;padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}" +
    "#auth button{font:inherit;font-weight:600;padding:14px;border-radius:14px;border:0;background:var(--accent);color:var(--bg);cursor:pointer}" +
    "#auth button.link{background:none;color:var(--muted);padding:6px;font-weight:500}" +
    "#auth .msg{min-height:18px;font-size:13px;color:var(--late)}";
  document.head.appendChild(css);

  function showAuth(mode, note) {
    var box = document.getElementById("auth");
    if (!box) { box = document.createElement("div"); box.id = "auth"; document.body.appendChild(box); }
    var up = mode === "up", reset = mode === "reset";
    box.innerHTML =
      '<form id="authform"><h1>Planner</h1><p>' + (reset ? "We will email you a link to set a new password." : up ? "Create your login." : "Sign in to your planner.") + "</p>" +
      (up ? '<input id="a-name" placeholder="Your name" autocomplete="name">' : "") +
      '<input id="a-email" type="email" placeholder="Email" autocomplete="email" required>' +
      (reset ? "" : '<input id="a-pass" type="password" placeholder="Password" autocomplete="' + (up ? "new-password" : "current-password") + '" required minlength="6">') +
      '<div class="msg" id="a-msg">' + (note || "") + "</div>" +
      '<button type="submit">' + (reset ? "Send reset link" : up ? "Create account" : "Sign in") + "</button>" +
      (up || reset ? '<button type="button" class="link" data-m="in">Back to sign in</button>' : '<button type="button" class="link" data-m="up">Create an account</button><button type="button" class="link" data-m="reset">Forgot password</button>') +
      "</form>";
    box.querySelectorAll("[data-m]").forEach(function (b) { b.onclick = function () { showAuth(b.getAttribute("data-m")); }; });
    document.getElementById("authform").onsubmit = function (e) {
      e.preventDefault();
      var email = document.getElementById("a-email").value.trim(), msg = document.getElementById("a-msg");
      var pe = document.getElementById("a-pass"), pass = pe ? pe.value : "";
      msg.textContent = "";
      var p;
      if (reset) p = sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" }).then(function (r) { if (!r.error) msg.textContent = "Check your email for the link."; return r; });
      else if (up) p = sb.auth.signUp({ email: email, password: pass, options: { data: { name: (document.getElementById("a-name").value || "").trim() } } }).then(function (r) { if (!r.error && !r.data.session) msg.textContent = "Check your email to confirm, then sign in."; return r; });
      else p = sb.auth.signInWithPassword({ email: email, password: pass });
      p.then(function (r) { if (r && r.error) msg.textContent = r.error.message; });
    };
  }

  function footer() {
    if (document.getElementById("who")) return;
    var f = document.createElement("div"); f.id = "who";
    f.style.cssText = "text-align:center;padding:28px 16px 40px;font-size:12px;color:var(--muted);font-family:var(--font-body)";
    f.innerHTML = (me.email || "") + ' · <a href="#" style="color:inherit">Sign out</a>';
    f.querySelector("a").onclick = function (e) { e.preventDefault(); sb.auth.signOut(); };
    document.body.appendChild(f);
  }
  function hideAuth() { var b = document.getElementById("auth"); if (b) b.remove(); }

  function blocked() {
    var box = document.getElementById("auth") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "auth" }));
    box.innerHTML = '<form><h1>Waiting for approval</h1><p>You are signed in as ' + (me.email || "") + ', but the owner has not added you yet. Ask them to add your email, then reload.</p><button type="button" id="a-out">Sign out</button></form>';
    document.getElementById("a-out").onclick = function () { sb.auth.signOut(); };
  }

  function boot() {
    if (!configured) {
      var b = document.createElement("div"); b.id = "auth";
      b.innerHTML = '<form><h1>Almost there</h1><p>Add your Supabase URL and anon key to <b>config.js</b> to turn on login and sync.</p></form>';
      document.body.appendChild(b); return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    var started = false;
    function onSession(session) {
      if (!session) { me = null; started = false; var w = document.getElementById("who"); if (w) w.remove(); showAuth("in"); return; }
      me = session.user;
      sb.from("profiles").select("name,is_owner,approved").eq("id", me.id).maybeSingle().then(function (r) {
        var p = r.data;
        if (!p || !p.approved) { blocked(); return; }
        profile = p; hideAuth(); footer();
        if (!started) { started = true; resolveReady(); } else if (started) { /* token refresh: nothing to do */ }
      });
    }
    sb.auth.onAuthStateChange(function (ev, s) { if (ev === "TOKEN_REFRESHED") return; onSession(s); });
    sb.auth.getSession().then(function (r) { if (!r.data.session) showAuth("in"); });
  }

  /* ---------- database with Firestore-style calls ---------- */
  var cache = {}, subs = {};
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function scopeOf(coll) { var m = /^data\/users\/([^/]+)\/mine\//.exec(coll); return m ? (m[1] === "me" ? me.id : m[1]) : null; }
  function bucket(c) { return cache[c] || (cache[c] = {}); }
  function snap(c) {
    var b = bucket(c);
    return { docs: Object.keys(b).map(function (id) { return { id: id, data: function () { return JSON.parse(JSON.stringify(b[id])); } }; }) };
  }
  function fire(c) { (subs[c] || []).forEach(function (f) { try { f(snap(c)); } catch (e) {} }); }
  function split(p) { var i = p.lastIndexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; }
  function fail(r) { if (r.error) { console.warn(r.error); throw r.error; } return r; }

  var channel = null;
  function listen() {
    if (channel) return;
    channel = sb.channel("docs").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, function (p) {
      var row = p.new && p.new.coll ? p.new : p.old; if (!row || !row.coll || !subs[row.coll]) return;
      if (p.eventType === "DELETE") delete bucket(row.coll)[row.id]; else bucket(row.coll)[row.id] = row.data;
      fire(row.coll);
    }).subscribe();
  }
  function load(c) {
    return sb.from("docs").select("id,data").eq("coll", c).then(function (r) {
      if (r.error) throw r.error;
      cache[c] = {}; r.data.forEach(function (x) { cache[c][x.id] = x.data; });
    });
  }

  var db = {
    collection: function (c) {
      return {
        add: function (d) { var id = uid(); bucket(c)[id] = d; fire(c); return sb.from("docs").insert({ coll: c, id: id, owner_scope: scopeOf(c), data: d }).then(fail).then(function () { return { id: id }; }); },
        onSnapshot: function (ok, err) {
          (subs[c] = subs[c] || []).push(ok); listen();
          load(c).then(function () { ok(snap(c)); }, function (e) { if (err) err(e); });
          return function () { subs[c] = subs[c].filter(function (f) { return f !== ok; }); };
        }
      };
    },
    doc: function (path) {
      var s = split(path), c = s[0], id = s[1];
      return {
        set: function (d) { bucket(c)[id] = d; fire(c); return sb.from("docs").upsert({ coll: c, id: id, owner_scope: scopeOf(c), data: d, updated_at: new Date().toISOString() }).then(fail); },
        update: function (patch) { bucket(c)[id] = Object.assign({}, bucket(c)[id] || {}, patch); fire(c); return sb.rpc("docs_merge", { p_coll: c, p_id: id, p_patch: patch, p_scope: scopeOf(c) }).then(fail); },
        delete: function () { delete bucket(c)[id]; fire(c); return sb.from("docs").delete().eq("coll", c).eq("id", id).then(fail); }
      };
    }
  };

  var names = {};
  var userCap = {
    id: function () { return me.id; },
    isOwner: function () { return !!profile.is_owner; },
    signOut: function () { return sb.auth.signOut(); },
    profiles: function (ids) {
      return sb.from("profiles").select("id,name").in("id", ids).then(function (r) { var o = {}; (r.data || []).forEach(function (p) { o[p.id] = { name: p.name }; }); return o; });
    }
  };

  window.claude = { use: function (k) { return ready.then(function () { return k === "db" ? db : k === "user" ? userCap : null; }); } };
  window.PlannerAuth = { signOut: function () { return sb && sb.auth.signOut(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
