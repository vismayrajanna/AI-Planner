/* Local stand-in for the Claude artifact database.
   Stores everything in this browser (localStorage). No sync between devices yet.
   Replace this file with a Supabase/Firebase adapter exposing the same API for cloud sync. */
(function () {
  if (window.claude && window.claude.use) return;
  var KEY = "planner-db-v1", data = {}, subs = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { data = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
  function col(n) { return data[n] || (data[n] = {}); }
  function snap(n) {
    var c = col(n);
    return { docs: Object.keys(c).map(function (id) { return { id: id, data: function () { return JSON.parse(JSON.stringify(c[id])); } }; }) };
  }
  function emit(n) { save(); (subs[n] || []).forEach(function (f) { try { f(snap(n)); } catch (e) {} }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function split(p) { var i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; }
  var db = {
    collection: function (n) {
      return {
        add: function (d) { var id = uid(); col(n)[id] = d; emit(n); return Promise.resolve({ id: id }); },
        onSnapshot: function (ok) { (subs[n] = subs[n] || []).push(ok); setTimeout(function () { ok(snap(n)); }, 0); return function () { subs[n] = subs[n].filter(function (f) { return f !== ok; }); }; }
      };
    },
    doc: function (p) {
      var s = split(p), n = s[0], id = s[1];
      return {
        set: function (d) { col(n)[id] = d; emit(n); return Promise.resolve(); },
        update: function (d) { col(n)[id] = Object.assign({}, col(n)[id] || {}, d); emit(n); return Promise.resolve(); },
        delete: function () { delete col(n)[id]; emit(n); return Promise.resolve(); }
      };
    }
  };
  window.claude = { use: function (k) { return Promise.resolve(k === "db" ? db : null); } };
})();
