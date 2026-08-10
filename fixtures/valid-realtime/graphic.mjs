export default class ScoreboardGraphic extends HTMLElement {
  #data = {}
  #currentStep
  #schedule = []

  async load({ data }) {
    this.#data = { ...data }
    this.#currentStep = undefined
    this.#render()
    this.hidden = true

    return { statusCode: 200 }
  }

  async dispose() {
    this.#schedule = []
    this.#currentStep = undefined
    this.replaceChildren()

    return { statusCode: 200 }
  }

  async playAction({ delta = 1, goto } = {}) {
    const target = goto ?? ((this.#currentStep ?? -1) + delta)
    if (target >= 2) {
      this.#currentStep = undefined
      this.hidden = true
    } else {
      this.#currentStep = Math.max(0, target)
      this.hidden = false
    }

    return { statusCode: 200, currentStep: this.#currentStep }
  }

  async stopAction() {
    this.hidden = true
    this.#currentStep = undefined

    return { statusCode: 200 }
  }

  async updateAction({ data }) {
    this.#data = { ...this.#data, ...data }
    this.#render()

    return { statusCode: 200 }
  }

  async customAction({ id, payload }) {
    if (id === 'set-period' && payload && typeof payload.period === 'string') {
      this.#data.period = payload.period
      this.#render()

      return { statusCode: 200 }
    }

    return { statusCode: 404, statusMessage: `Unknown action: ${id}` }
  }

  async goToTime({ timestamp }) {
    this.dataset.timestamp = String(timestamp)

    return { statusCode: 200 }
  }

  async setActionsSchedule({ schedule }) {
    this.#schedule = [...schedule]

    return undefined
  }

  #render() {
    const home = String(this.#data.homeTeam ?? 'Home')
    const away = String(this.#data.awayTeam ?? 'Away')
    const homeScore = Number(this.#data.homeScore ?? 0)
    const awayScore = Number(this.#data.awayScore ?? 0)
    const period = String(this.#data.period ?? 'first')
    this.innerHTML = `
      <style>
        :host { display: block; position: absolute; top: 4%; left: 50%; transform: translateX(-50%); color: white; font-family: Arial, sans-serif; }
        .board { display: flex; gap: 18px; align-items: center; min-width: 460px; padding: 12px 22px; background: rgb(20 20 20 / 92%); }
        .team { flex: 1; font-size: 26px; font-weight: 700; }
        .away { text-align: right; }
        .score { font-size: 34px; font-weight: 800; }
        .period { color: #bbb; font-size: 14px; }
      </style>
      <div class="board"><span class="team home"></span><strong class="score"></strong><span class="team away"></span><small class="period"></small></div>
    `
    this.querySelector('.home').textContent = home
    this.querySelector('.away').textContent = away
    this.querySelector('.score').textContent = `${homeScore} - ${awayScore}`
    this.querySelector('.period').textContent = period
  }
}
