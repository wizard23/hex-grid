import { render } from "preact";
import { App } from "./app";
import { initTheme } from "./theme";
import "./styles.css";

initTheme();
const el = document.getElementById("app");
if (!el) throw new Error("#app not found");
render(<App />, el);
