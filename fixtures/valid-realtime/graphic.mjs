// Stub Web Component for testing
class Scoreboard extends HTMLElement {
  load(data) { this.data = data }
  play() {}
  stop() {}
}
customElements.define('football-scoreboard', Scoreboard)
