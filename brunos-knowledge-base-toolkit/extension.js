// Bruno's Knowledge Base Toolkit — one extension, one handler per file type.
//
// Each handler in renderers/ owns everything its file type needs: the custom
// editor, plus any commands, keybindings or state that go with it. This file
// only decides which handlers exist, so adding a third file type means adding a
// module and a line here, and touching nothing else.

const markdown = require("./renderers/markdown");
const diff = require("./renderers/diff");

const HANDLERS = [markdown, diff];

function activate(context) {
  for (const handler of HANDLERS) handler.register(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
