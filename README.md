# BroderyFlow

BroderyFlow is a desktop canvas for JavaScript workflows, built with Tauri 2, React, React Flow and CodeMirror.

English is the default interface language. Open the gear menu in the top toolbar and use **Language** to switch between **English** and **Deutsch**. The preference is saved locally and applies across workflows and app restarts. Switching language does not translate or rename your code, node titles, constants, or imported data.

## Development

Install the JavaScript dependencies and start the web app:

```sh
npm install
npm run dev
```

To run the Tauri desktop app or build a distributable, install Rust and the platform prerequisites from the [Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm run tauri dev
npm run tauri build
```

## Docker

Build and start the web version:

```sh
docker build -t flowweave .
docker run --rm -p 8080:8080 flowweave
```

Open [http://localhost:8080](http://localhost:8080). In the browser version, use **Open** to load a project file and **Save** to download it.

Use **Open** and **Save** for versioned JSON project files. Multiple workflows can stay open in tabs; **+** creates a new workflow, and closing a tab does not affect the others. **Open** adds the selected project as a new tab, while **Save** saves the active workflow. In a normal browser session, projects open through the file picker and save as a downloaded JSON file.

Saved files use the `.flowweave.json` extension. Existing Noder JSON projects remain compatible, including file nodes with the older `daten` output. Existing app identifiers and settings storage keys are retained for compatibility.

New projects start with one empty code node. **Node** adds another code node, and **Values** adds a value node for named constants. Add one or more name/value rows there; values are interpreted as numbers or `true`/`false` when they match, and otherwise as text. Each named value becomes a typed output that can be connected to code nodes. Value nodes are saved with the project like code nodes.

Drop an output onto the body of a **Values** node to create an input connection and use **Code → Values → Code**. Running the Values node also runs its upstream dependencies and refreshes incoming values. Objects and arrays expand recursively into editable rows such as `user.name` and `items[0].price`; run once to discover their output fields, then connect these to downstream nodes. Existing constants remain, and duplicate field names receive numeric suffixes. Linked rows preserve incoming types (including CSV text, null, and empty objects/arrays) until you edit them. Editing a linked value enables a persistent manual override using the usual Values-node type detection; **Restore input value** disables it for the next run. Local constants, bindings, overrides, and connections are saved in the project. Removing an input connection keeps its displayed rows as independent constants. Circular references and unsupported values report an error instead of partially updating rows.

If the source already has a calculated result, dropping its output onto a Values node immediately previews the individual fields. JSON text starting with `{` or `[` is parsed and expanded just like an object or array; malformed JSON displays an error. Without a calculated result, run the Values node to populate its fields.

Every Values node also has an **allValues** object output containing all current named values, including local constants and manual overrides. It uses the same path rules as the Collector: `user.name` creates a nested object, and `hobbies[0]` / `hobbies[2]` create a compact array without missing-index placeholders. Conflicting or malformed paths produce an error. Individual outputs retain their original names and values. If a constant is already named `allValues`, the combined output uses the next available name (`allValues2`, etc.). An empty Values node outputs `{}`.

Values are grouped into collapsible accordions by input source, with a separate **Local constants** group. Each source heading shows the source node title, output, and field count, with its input connector directly beside it. Hover over the heading to see the input name. Expand a group to edit its values without repeated source labels below each field. Manually overridden values have a highlighted reset button; resetting restores the incoming value on the next run. Collapsing a group only hides its rows; its values and existing connections remain intact.

Drop outputs from multiple sources onto the Values node body to add separate inputs. Outputs with the same name (for example, two `allValues` outputs) receive distinct input names such as `allValues` and `allValues2`; both source groups are retained.

Use **File (JSON / CSV)** in the canvas context menu or **Add file node** in the quick-start panel to import a local UTF-8 file. Select the file in the node and connect its **data** output to another node (`inputs.data`). JSON preserves its original structure, including arrays and primitive values. CSV uses the first row as column names and produces an array of row objects; separators are detected automatically, quoted fields and line breaks are supported, and all cell values remain strings. Invalid files display an error. File contents are embedded in saved project files, not read again from a filesystem path; use the file picker again to refresh them. **Clear** removes the imported file.

Use **View (Table / JSON / Chart)** from the canvas context menu or when dragging an output onto empty space to visualize data. Connect an output to the node's **data** input (or drop it onto the node body), then run the workflow or the node. **View** switches immediately between a table, formatted JSON, and a bar or line chart without rerunning. Tables accept arrays of objects, individual objects, and primitive values. Charts use row order on the X axis, with optional column labels; select a numeric Y column, or let the node detect it automatically. Numeric CSV strings are supported, including negative values. Tables and charts preview the first 100 rows and show a notice when more rows exist; JSON displays the complete value. Invalid chart data displays an explicit error. View and chart settings are saved with the project; execution results are not. **Clear** clears the displayed data while preserving the input connection and view settings.

In the JSON view, select text to copy individual parts, or use **Copy** in the top-right corner to copy the entire formatted JSON, including content outside the visible scroll area. Clipboard access requires browser permission and HTTPS or localhost; failures display an error, and manual text selection remains available.

View nodes have a direct delete button in the header and are removed without a confirmation dialog, like Show and Debug nodes.

Use **Collector** in the canvas context menu, output-drop menu, or quick-start panel to combine inputs into one object. Drop outputs onto its body to add named inputs automatically. Duplicate names receive numeric suffixes (`name`, `name2`, ...). Run the Collector or the workflow to produce `{ data: { inputName: value, ... } }`. Connect its **data** output to a code node and use `inputs.data`, or to a View node to inspect the JSON. Values retain their types, including nested objects and arrays; the output is a JavaScript object, not serialized JSON text. A Collector without inputs produces an empty object. Unconnected inputs are removed automatically. Inputs and connections are saved in project files.

Collector input names are paths: `user.name` creates a nested object, and `hobbies[0]` / `hobbies[1]` create an array. Combined paths such as `users[0].name` are supported. Array entries are sorted by numeric index regardless of input order; missing indices are skipped without empty slots or `null` placeholders. For example, `hobbies[0]` and `hobbies[2]` produce a two-element array. Conflicting paths such as `user` and `user.name`, or mixing `items[0]` with `items.name`, produce an error instead of overwriting data. Malformed paths are rejected.

Delete a Collector directly with the trash button in its header, without opening settings or a confirmation dialog. Its connected edges are removed as well.

New nodes are named `node-code-x`, `node-values-x` or `node-condition-x`, starting with the total number of existing nodes plus one (including Show/Debug nodes). Existing names are skipped to avoid duplicates after deletions. Existing titles are not renamed; Show/Debug keep their fixed headings. Internal IDs remain independent of display names.

Right-click the canvas to open the **+ Node / + Values** menu instead of the browser menu. The selected node is created at the clicked canvas position. Click outside the menu or press Escape to dismiss it.

Right-click a node to choose its header color (saved with the project). Deleting a code, value or If/Else node with content or connections opens a themed confirmation modal listing the affected nodes, including deletion with the keyboard. Choose **Cancel** or press Escape to keep them, or **Delete** to confirm. Empty nodes and Show/Debug nodes are removed immediately without confirmation.

The gear in the top toolbar opens global settings. **Confirm node deletion** enables or disables deletion confirmations for both delete buttons and keyboard deletion. It is enabled by default and persisted locally across app restarts, independently of project files.

Write only the body of `run(inputs)` in each node's editor. Inputs are inferred from static references such as `inputs.value`, and outputs from the keys in returned object literals. Their types are inferred from literals and explicit `Number`, `String` or `Boolean` conversions; other expressions use a compatible `any` type. Set an unconnected input's value in its row, or connect it to another node. The app supplies `inputs` and runs the code asynchronously. A node may return nothing, or return an object containing output values, for example `return { result: Number(inputs.value) * 2 };`. Projects using the older `async function run(inputs) { ... }` editor format are converted to body-only code when opened.

In the code editor, press **Ctrl+Space** after an expression such as `inputs.fruit` and choose **“Create variable fruit”** to replace it with `const fruit = inputs.fruit;`.

Press **Ctrl+Space** on a declared variable to choose **“Add fruit to return”** (selected first, retaining existing outputs) or **“Return only fruit”** (replacing the returned object with `{ fruit }`). Without a return, either choice appends `return { fruit };`. Existing JavaScript suggestions remain available.

Run the entire graph with **Run workflow** in the top toolbar. The play button at the bottom of a node runs that node and recursively executes every connected upstream dependency first; unrelated branches are skipped. `debug(variable)` prints the variable name and value, while `show(expression)` displays only the value. Both helpers return their argument so they can be used inline.

Drag an output handle onto empty canvas space to choose **+ Node**, **+ Show** or **+ Debug**. The selected node is created at the drop position and connected automatically. A code node receives the value in a `const` declaration and returns it through an output with the same name; display nodes only show it. Dismiss the menu to cancel without creating a node.

Drop an output connection onto the body of an existing code node to add and connect a matching input. A `const name = inputs.name;` declaration is inserted after the last existing top-level input declaration, or at the beginning if none exists. Existing matching declarations are reused; conflicting variable names receive a numeric suffix.

While dragging over a code node, a yellow insertion line marks the position between input rows. Drop there to insert the new input and its `const` declaration at that position; dropping below the inputs appends it to the input declarations.

Add an **If / Else** node to branch on a JavaScript expression such as `inputs.value > 10`. Connect its `true` and `false` outputs to downstream nodes; only the selected branch and its downstream flow are executed. The branch output also provides the corresponding boolean value to the connected node.

**Show** and **Debug** nodes are display-only sinks, available from the right-click menu and quick-start panel. Drop outputs onto them to add named, typed inputs automatically; names come from the source nodes. They have no editable node name, code editor or outputs, only a fixed type heading and display, delete and run controls. Run the workflow or their play button to display incoming values as green RESULT badges (Show) or yellow DEBUG badges with names and values (Debug).

Unconnected inputs on Show and Debug nodes are removed automatically, including when a connection or source node is deleted. Existing displayed messages remain until cleared or the node is run again.

Debug nodes have a yellow body and Show nodes a green body in both themes, making display nodes easy to identify on the canvas.

Use the gear in a node header to edit its name or delete the node. **Clear**, next to the gear, resets code, constants, inputs, displayed messages, errors and execution state, and removes all connections to that node, while keeping its title, color, position and type. If/Else nodes retain their two fixed branch outputs. Show and Debug settings offer deletion but no name editing.

On Show and Debug nodes, **Clear only removes displayed messages**; inputs, connections and execution status remain unchanged.

Select a code node to reveal a subtle resize grip in its bottom-right corner, without a blue resize frame. Its minimum width is 370 pixels; minimum height is 240 pixels plus space for its ports (100 pixels plus ports when collapsed). Code node sizes are saved with the project. Value, If/Else, Show and Debug nodes size automatically to their content and cannot be manually resized.

Editing a node's code or condition sets its footer status to yellow **Changed**. It only returns to **Successful** after a successful run.

Code cards separate their title, code editor, DEBUG/RESULT messages and footer status. The editor and message area scroll independently; the footer stays visible. Collapsed code cards show only their title bar and status footer; input/output rows and resize controls are hidden until expanded. Existing connections are preserved.

## Workflow code safety

Node JavaScript executes sequentially in a Web Worker without Tauri APIs or filesystem access. Workers keep synchronous loops from freezing the canvas and are stopped after a 10-second execution limit. A Web Worker is not a security boundary: node code may still use browser worker capabilities, including network access. Only run code you trust; this prototype is not suitable for untrusted workflows.
