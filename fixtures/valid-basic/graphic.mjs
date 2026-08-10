export default class LowerThirdGraphic extends HTMLElement {
  #data = {}
  #currentStep

  async load({ data }) {
    this.#data = { ...data }
    this.#currentStep = undefined
    this.#render()
    this.hidden = true

    return { statusCode: 200 }
  }

  async dispose() {
    this.replaceChildren()
    this.#currentStep = undefined

    return { statusCode: 200 }
  }

  async playAction({ delta = 1, goto, skipAnimation = false } = {}) {
    const target = goto ?? ((this.#currentStep ?? -1) + delta)
    if (target >= 1) {
      this.#currentStep = undefined
      this.hidden = true
    } else {
      this.#currentStep = Math.max(0, target)
      this.hidden = false
      this.style.transition = skipAnimation ? 'none' : 'opacity 250ms ease'
      this.style.opacity = '1'
    }

    return { statusCode: 200, currentStep: this.#currentStep }
  }

  async stopAction({ skipAnimation = false } = {}) {
    this.style.transition = skipAnimation ? 'none' : 'opacity 200ms ease'
    this.style.opacity = '0'
    this.hidden = true
    this.#currentStep = undefined

    return { statusCode: 200 }
  }

  async updateAction({ data }) {
    this.#data = { ...this.#data, ...data }
    this.#render()

    return { statusCode: 200 }
  }

  async customAction({ id }) {
    if (id === 'clear') {
      this.#data = { headline: '', subline: '' }
      this.#render()

      return { statusCode: 200 }
    }

    return { statusCode: 404, statusMessage: `Unknown action: ${id}` }
  }

  #render() {
    const headline = String(this.#data.headline ?? '')
    const subline = String(this.#data.subline ?? '')
    this.innerHTML = `
      <style>
        :host { display: block; position: absolute; left: 4%; bottom: 8%; color: white; font-family: Arial, sans-serif; }
        .card { min-width: 360px; padding: 16px 24px; background: rgb(0 0 0 / 85%); }
        strong { display: block; font-size: 32px; }
        span { display: block; margin-top: 4px; color: #ccc; font-size: 22px; }
      </style>
      <div class="card"><strong></strong><span></span></div>
    `
    this.querySelector('strong').textContent = headline
    this.querySelector('span').textContent = subline
  }
}
