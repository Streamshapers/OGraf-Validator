// Stub Web Component for testing
class LowerThird extends HTMLElement {
  load(data) { this.data = data }
  play() {}
  stop() {}
}
customElements.define('lower-third', LowerThird)
