import "./popup.css";
import popupMarkup from "./popup.html?raw";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = popupMarkup;
}
