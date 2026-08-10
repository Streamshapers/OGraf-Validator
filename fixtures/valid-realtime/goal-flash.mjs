export default class GoalFlashGraphic extends HTMLElement {
  #data = {}

  async load({ data }) {
    this.#data = { ...data }
    this.#render()
    this.hidden = true

    return { statusCode: 200 }
  }

  async dispose() {
    this.replaceChildren()

    return { statusCode: 200 }
  }

  async playAction() {
    this.hidden = false

    return { statusCode: 200, currentStep: undefined }
  }

  async stopAction() {
    this.hidden = true

    return { statusCode: 200 }
  }

  async updateAction({ data }) {
    this.#data = { ...this.#data, ...data }
    this.#render()

    return { statusCode: 200 }
  }

  async customAction() {
    return { statusCode: 404, statusMessage: 'No custom actions are declared.' }
  }

  #render() {
    this.innerHTML = `<strong></strong><span></span>`
    this.querySelector('strong').textContent = String(this.#data.scorer ?? 'GOAL')
    this.querySelector('span').textContent = String(this.#data.team ?? '')
  }
}
