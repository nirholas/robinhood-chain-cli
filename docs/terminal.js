/*
 * hood-cli docs — interactive terminal engine.
 *
 * Progressive enhancement only: the full command reference is already static
 * HTML in the page before this file ever runs (see the #reference section).
 * This script never invents output. On Enter it does exactly one of three
 * things:
 *
 *   1. Exact match against a real captured mainnet frame (docs/session.json,
 *      embedded on the page as #session-data) -> replays that real output.
 *   2. First word matches a real hood-cli command (docs/commands-data.json,
 *      embedded as #commands-data) -> prints that command's real, unedited
 *      `--help` text.
 *   3. Neither -> prints an honest "unknown command" message, clearly
 *      labelled as a docs-site message, never dressed up as CLI output.
 *
 * No fetch(), no external requests — everything needed is already inlined
 * in the page, so this also works when the file is opened directly via
 * file:// with no server.
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('commands-data');
  var sessionEl = document.getElementById('session-data');
  var output = document.getElementById('term-output');
  var form = document.getElementById('term-form');
  var input = document.getElementById('term-input');
  var suggestions = document.getElementById('term-suggestions');

  if (!dataEl || !sessionEl || !output || !form || !input || !suggestions) return;

  var commandsData = JSON.parse(dataEl.textContent);
  var sessionData = JSON.parse(sessionEl.textContent);
  var commands = commandsData.commands || [];
  var frames = sessionData.frames || [];
  var commandNames = commands.map(function (c) { return c.name; });

  var capturedLabel = sessionData.capturedAt
    ? new Date(sessionData.capturedAt).toISOString().slice(0, 10)
    : 'a real mainnet run';

  var cmdHistory = [];
  var historyIndex = -1;
  var tabState = { prefix: null, matches: [], cycle: -1 };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // Real ANSI codes come straight from the captured session. We only ever
  // restyle them by weight/opacity, never hue, to keep the whole site
  // monochrome — the underlying text is untouched.
  function ansiToHtml(s) {
    var out = escapeHtml(s);
    var openTags = 0;
    out = out.replace(/\x1b\[(\d+(?:;\d+)*)m/g, function (_, codes) {
      var parts = codes.split(';').map(Number);
      var spans = '';
      for (var i = 0; i < parts.length; i++) {
        var c = parts[i];
        if (c === 0) { spans += repeat('</span>', openTags); openTags = 0; }
        else if (c === 1) { spans += '<span class="a-bold">'; openTags++; }
        else if (c === 2) { spans += '<span class="a-dim">'; openTags++; }
        else if (c === 22) { spans += '</span>'; openTags = Math.max(0, openTags - 1); }
        else if (c === 32 || c === 31) { spans += '<span class="a-strong">'; openTags++; }
        else if (c === 90) { spans += '<span class="a-faint">'; openTags++; }
        else if (c === 39) { spans += '</span>'; openTags = Math.max(0, openTags - 1); }
        else if (c === 38 && parts[i + 1] === 5) { spans += '<span class="a-strong">'; openTags++; i += 2; }
      }
      return spans;
    });
    out += repeat('</span>', openTags);
    return out;
  }

  function repeat(str, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += str;
    return out;
  }

  function appendEntry(promptText, captionText, bodyHtml, bodyClass) {
    var entry = document.createElement('div');
    entry.className = 'term-entry';
    entry.innerHTML =
      '<div class="term-prompt"><span class="prompt-glyph" aria-hidden="true">❯</span><span class="term-cmd">' +
      escapeHtml(promptText) + '</span></div>' +
      '<div class="term-caption">' + escapeHtml(captionText) + '</div>' +
      '<pre class="term-block ' + bodyClass + '">' + bodyHtml + '</pre>';
    output.appendChild(entry);
    output.scrollTop = output.scrollHeight;
  }

  function submitCommand(raw) {
    raw = raw.trim();
    if (!raw) return;
    cmdHistory.push(raw);
    historyIndex = cmdHistory.length;

    var cmdLine = raw.replace(/^hood\s+/, '').trim();
    var caption, html, cls;

    if (cmdLine === '' || cmdLine === 'help' || cmdLine === '--help' || cmdLine === '-h') {
      caption = 'hood --help · top-level usage';
      html = escapeHtml(commandsData.root);
      cls = 'term-help';
    } else {
      var frame = frames.filter(function (f) {
        return f.prompt.replace(/^hood\s+/, '') === cmdLine;
      })[0];

      if (frame) {
        caption = 'real captured mainnet output · ' + capturedLabel;
        html = ansiToHtml(frame.output);
        cls = 'term-real';
      } else {
        var firstToken = cmdLine.split(/\s+/)[0];
        var cmd = commands.filter(function (c) { return c.name === firstToken; })[0];

        if (cmd) {
          caption = cmdLine === firstToken
            ? 'hood ' + firstToken + ' --help'
            : 'no captured live run for these exact arguments — showing hood ' + firstToken + ' --help';
          html = escapeHtml(cmd.help);
          cls = 'term-help';
        } else {
          caption = 'hood-cli docs';
          html = escapeHtml(
            "hood: unknown command '" + firstToken + "'\n" +
            'Run `help`, press Tab, or tap a suggestion below.'
          );
          cls = 'term-error';
        }
      }
    }

    appendEntry(raw, caption, html, cls);
  }

  function renderSuggestions(prefix) {
    suggestions.innerHTML = '';
    commandNames.forEach(function (name) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var isMatch = !!prefix && name.indexOf(prefix) === 0;
      btn.className = 'sugg-btn' + (isMatch ? ' match' : '');
      btn.textContent = name;
      btn.setAttribute('aria-label', 'Insert command: hood ' + name);
      btn.addEventListener('click', function () {
        input.value = name + ' ';
        input.focus();
        tabState.prefix = null;
        renderSuggestions(name);
      });
      suggestions.appendChild(btn);
    });
  }

  function markCurrent(name) {
    Array.prototype.forEach.call(suggestions.querySelectorAll('.sugg-btn'), function (btn) {
      btn.classList.toggle('current', btn.textContent === name);
    });
  }

  input.addEventListener('input', function () {
    var first = input.value.split(/\s+/)[0] || '';
    renderSuggestions(first);
    tabState.prefix = null;
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      var val = input.value;
      var firstSpace = val.search(/\s/);
      var prefix = firstSpace === -1 ? val : val.slice(0, firstSpace);
      var matches = commandNames.filter(function (n) { return n.indexOf(prefix) === 0; });
      if (matches.length === 0) return; // let focus move normally
      e.preventDefault();
      if (tabState.prefix !== prefix) {
        tabState.prefix = prefix;
        tabState.matches = matches;
        tabState.cycle = -1;
      }
      tabState.cycle = (tabState.cycle + 1) % matches.length;
      var chosen = matches[tabState.cycle];
      input.value = chosen + (matches.length === 1 ? ' ' : '');
      renderSuggestions(prefix);
      markCurrent(chosen);
    } else if (e.key === 'ArrowUp') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = cmdHistory[historyIndex] || '';
    } else if (e.key === 'ArrowDown') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      historyIndex = Math.min(cmdHistory.length, historyIndex + 1);
      input.value = cmdHistory[historyIndex] || '';
    } else if (e.key === 'Escape') {
      input.value = '';
      renderSuggestions('');
    } else {
      tabState.prefix = null;
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitCommand(input.value);
    input.value = '';
    tabState.prefix = null;
    renderSuggestions('');
  });

  // Clicking a command name in the static reference below drops it straight
  // into the terminal input — the two halves of the page (live terminal,
  // static reference) stay wired together instead of living in isolation.
  document.querySelectorAll('.ref-cmd[data-cmd]').forEach(function (section) {
    var heading = section.querySelector('h3 a');
    if (!heading) return;
    heading.addEventListener('click', function () {
      var name = section.getAttribute('data-cmd');
      input.value = name + ' ';
      renderSuggestions(name);
    });
  });

  document.querySelectorAll('button.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text).then(function () {
          var prev = btn.textContent;
          btn.textContent = 'copied';
          setTimeout(function () { btn.textContent = prev; }, 1200);
        });
      }
    });
  });

  renderSuggestions('');
})();
