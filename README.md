# BroderyFlow

BroderyFlow is a visual editor for building JavaScript workflows from connected nodes. It runs in a browser or as a desktop app built with Tauri.

> **Interface languages:** English and German. Change the language from **Settings** (the gear button) in the top bar.

## Screenshots

You can add screenshots or other images to this README. Put image files in `docs/images/`, then add a Markdown image link where you want the image to appear:

```md
![Description of the screenshot](docs/images/workflow.png)
```

For example, save a screenshot as `docs/images/workflow.png` and use the snippet above. Relative paths keep images working when the project is shared or hosted on GitHub.

<!-- Add your screenshots here, for example:
![BroderyFlow workflow canvas](docs/images/workflow.png)
-->

## Features

- Build workflows by connecting typed input and output ports on a canvas.
- Write JavaScript in Code nodes, or use Values, If/Else, File, View, Collector, Show, and Debug nodes.
- Inspect data as tables, JSON, or charts.
- Save and open projects as JSON; keep multiple workflows open in tabs.
- Switch between dark and light themes, and collapse the node sidebar when you need more canvas space.

## Quick start

### Run in a browser

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in your browser.

### Run as a desktop app

Install Rust and the platform prerequisites listed in the [Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm install
npm run tauri dev
```

To create a desktop build:

```sh
npm run tauri build
```

### Run with Docker

```sh
docker compose up --build -d
```

Then open [http://localhost:8080](http://localhost:8080). Stop the app with:

```sh
docker compose down
```

## Nodes

| Node | What it does |
| --- | --- |
| **Code** | Runs JavaScript with connected values available through `inputs`. Return an object to provide outputs. |
| **Values** | Defines constants and exposes connected values as outputs. The `allValues` output combines them into an object. |
| **If / Else** | Evaluates a JavaScript condition and exposes `true` and `false` branches. Only the selected branch runs. |
| **File** | Loads a local JSON or CSV file and provides its data through the `data` output. |
| **View** | Displays connected data as a table, formatted JSON, or a bar or line chart. |
| **Collector** | Combines named inputs into one object, available through the `data` output. |
| **Show** | Displays workflow results. Use `show(value)` in a Code node. |
| **Debug** | Writes variable names and values to the execution log. Use `debug(value)` in a Code node. |

Add nodes from the **Nodes** tab in the sidebar, or use the canvas context menu. The **Documentation** tab in the sidebar describes each node. Drag an output on the right of a node to an input on the left to connect them. You can also drop an output onto empty canvas space to create a node and connect it.

## Writing and running code

Write the **body** of `run(inputs)` in a Code node. Inputs are inferred from references such as `inputs.price`; outputs are inferred from keys in returned object literals.

```js
return { total: Number(inputs.price) * 2 };
```

An unconnected input can be given a value in its row. Run the whole workflow with **Run workflow**, or use a node's play button to run it and its connected upstream dependencies. Code runs asynchronously in a Web Worker, and execution is limited to 10 seconds.

In the code editor, **Ctrl+Space** can create an input variable from an `inputs` reference or add a variable to the returned outputs.

## Working with data

- **Values:** Add named constants, or connect other nodes to populate values. Objects and arrays can be expanded into editable paths such as `user.name` and `items[0].price`. Editing an incoming value creates a manual override; reset it to restore the connected value.
- **Files:** Select a local UTF-8 JSON or CSV file in a File node. CSV uses the first row as headers, automatically detects separators, supports quoted fields, and keeps cell values as text. File contents are included in saved projects.
- **Views:** Connect data to a View node and run the workflow. Tables and charts preview up to 100 rows; JSON shows the complete value. Change view or chart options without rerunning.
- **Collectors:** Combine inputs into an object using their input names. Nested paths such as `user.name` and array paths such as `items[0]` are supported; conflicting paths report an error.
- **Conditions:** Use an expression such as `inputs.score > 10`. Connect the `true` and `false` outputs to the appropriate downstream nodes.

## Projects and settings

Use **Open** and **Save** in the top bar to load and save JSON project files. Each open project has its own workflow tab. In a regular browser session, opening uses the file picker and saving downloads the project.

Project files retain nodes, their positions and sizes, connections, values, imported file contents, and view settings. Execution results are not saved. Existing Noder JSON projects remain compatible, including older File nodes with a `daten` output. Project files use the `.flowweave.json` extension for compatibility with existing projects.

The gear menu contains language and node-deletion settings. Theme and preferences are stored locally; they are independent of project files.

## Safety note

Workflow JavaScript runs in a Web Worker without direct access to Tauri APIs or the filesystem, and execution is stopped after 10 seconds. **A Web Worker is not a security boundary:** node code may still use browser worker capabilities, including network access. Only run workflows you trust; this prototype is not suitable for untrusted code.

## Tech stack

React, TypeScript, [React Flow](https://reactflow.dev/), CodeMirror, and Tauri 2.

The original product concept is available in [docs/concept.md](docs/concept.md) (German).
