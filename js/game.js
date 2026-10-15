// Scoring, round mode, combos, achievements and the coach.

const store = {
  get(k, d) { try { const v = localStorage.getItem('yaboec:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('yaboec:' + k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
};

export const ACHIEVEMENTS = {
  first_hit: ['🥊', 'Первый удар', 'Ударь грушу'],
  combo10: ['🔥', 'Серия x10', 'Сделай комбо из 10 ударов'],
  combo25: ['⚙️', 'Машина', 'Комбо из 25 ударов'],
  counter: ['⚡', 'Контратака', 'Ударь грушу, летящую на тебя'],
  breaker: ['💥', 'Разрушитель', 'Порви грушу'],
  all_bags: ['🎯', 'Обход', 'Ударь все три груши'],
  acrobat: ['🤸', 'Акробат', 'Сделай сальто'],
  polite: ['👋', 'Вежливый боец', 'Поздоровайся'],
  dancer: ['🪩', 'Король танцпола', 'Танцуй 10 секунд'],
  hits100: ['💯', 'Сотня', '100 ударов за всё время'],
  champion: ['🏆', 'Чемпион', '2000+ очков за раунд'],
};

const RANKS = [[300, 'Новичок'], [700, 'Любитель'], [1200, 'Боец'], [2000, 'Профи'], [3000, 'Чемпион'], [Infinity, 'Легенда']];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Game {
  constructor(ui, sound) {
    this.ui = ui;
    this.sound = sound;
    this.mode = 'menu';
    this.best = store.get('best', 0);
    this.totalHits = store.get('hits', 0);
    this.unlocked = new Set(store.get('ach', []));
    this.voice = store.get('voice', true);
    this.reset();
    this.bagsHit = new Set();
    this.danceTime = 0;
    this._lastSpeak = 0;
    this.time = 0;
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.comboTimer = 0;
    this.roundLeft = 60;
    this.idle = 0;
    this.countdown = 0;
    this.warned10 = false;
    this.ui.setScore(0);
    this.ui.setCombo(0, 1);
  }

  get playing() { return this.mode === 'free' || (this.mode === 'round' && this.countdown <= 0 && this.roundLeft > 0); }

  startFree() {
    this.mode = 'free';
    this.reset();
    this.ui.setTimer(null);
    this.say(pick(['Разминаемся!', 'Погнали, боец!', 'Работаем!']), true);
  }

  startRound() {
    this.mode = 'round';
    this.reset();
    this.countdown = 3.999;
    this._lastCount = 4;
    this.ui.setTimer(60);
  }

  multiplier() { return 1 + Math.min(2, Math.floor(this.combo / 5) * 0.5); }

  onHit({ power, kick, counter, bag }) {
    if (!this.playing) return null;
    this.hits++;
    this.totalHits++;
    this.idle = 0;
    this.combo++;
    this.comboTimer = 1.6;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = this.multiplier();
    const pts = Math.round((kick ? 15 : 10) * power * mult * (counter ? 2 : 1));
    this.score += pts;
    this.ui.setScore(this.score);
    this.ui.setCombo(this.combo, mult);
    this.bagsHit.add(bag.index);

    this.unlock('first_hit');
    if (counter) this.unlock('counter');
    if (this.combo >= 10) this.unlock('combo10');
    if (this.combo >= 25) this.unlock('combo25');
    if (this.bagsHit.size >= 3) this.unlock('all_bags');
    if (this.totalHits >= 100) this.unlock('hits100');
    if (this.totalHits % 10 === 0) store.set('hits', this.totalHits);

    if (counter && Math.random() < 0.6) this.say(pick(['Контратака!', 'Встречный! Красиво!', 'Поймал на встречном!']));
    else if ([5, 10, 15, 25, 40].includes(this.combo)) {
      this.say({ 5: 'Хорошая серия!', 10: 'Огонь!', 15: 'Не останавливайся!', 25: 'Ты машина!', 40: 'Невероятно!' }[this.combo]);
    }
    return { pts, mult };
  }

  onBreak() {
    this.unlock('breaker');
    if (this.playing) {
      this.score += 250;
      this.ui.setScore(this.score);
      this.ui.popupCenter('ГРУША ПОРВАНА! +250', 'gold');
    }
    this.say(pick(['Ты порвал грушу!', 'Вот это мощь!', 'Несите новую!']), true);
  }

  onGreet() {
    this.unlock('polite');
    this.say(pick(['Привет, боец!', 'И тебе привет!', 'Здорово!']));
  }

  onFlip() {
    this.unlock('acrobat');
    this.say(pick(['Акробат!', 'Вот это трюк!', 'Красиво!']));
  }

  onDance(on) {
    if (on) this.say(pick(['Зажигай!', 'Дискотека!', 'Танцуют все!']));
  }

  unlock(id) {
    if (this.unlocked.has(id)) return;
    this.unlocked.add(id);
    store.set('ach', [...this.unlocked]);
    const [icon, title] = ACHIEVEMENTS[id];
    this.ui.toast(icon, title);
    this.sound.achievement();
  }

  setVoice(on) {
    this.voice = on;
    store.set('voice', on);
    if (!on && window.speechSynthesis) speechSynthesis.cancel();
  }

  say(text, force = false) {
    if (!force && this.time - this._lastSpeak < 2.5) return;
    this._lastSpeak = this.time;
    this.ui.coach(text);
    if (!this.voice || !window.speechSynthesis) return;
    try {
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => /^ru/i.test(x.lang));
      if (!v) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 1.08; u.pitch = 0.85; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (_) { /* speech is optional */ }
  }

  update(dt, dancing) {
    this.time += dt;
    if (dancing) {
      this.danceTime += dt;
      if (this.danceTime > 10) this.unlock('dancer');
    } else this.danceTime = 0;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0;
        this.ui.setCombo(0, 1);
      }
    }

    if (this.mode !== 'round') return;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this._lastCount) {
        this._lastCount = c;
        if (c > 0) { this.ui.bigText(String(c)); this.sound.ui(); }
        else {
          this.ui.bigText('БОЙ!');
          this.sound.bell(1);
          this.say(pick(['Бой!', 'Покажи, на что способен!', 'Вперёд!']), true);
        }
      }
      return;
    }
    if (this.roundLeft <= 0) return;
    this.roundLeft -= dt;
    this.idle += dt;
    if (this.idle > 5) { this.idle = 0; this.say(pick(['Работай, боец!', 'Руки не опускай!', 'Бей, не стой!'])); }
    if (!this.warned10 && this.roundLeft <= 10) {
      this.warned10 = true;
      this.sound.whistle();
      this.say('Последние десять секунд!', true);
    }
    this.ui.setTimer(Math.max(0, this.roundLeft));
    if (this.roundLeft <= 0) this._endRound();
  }

  _endRound() {
    this.sound.bell(3);
    const newBest = this.score > this.best;
    if (newBest) { this.best = this.score; store.set('best', this.best); }
    if (this.score >= 2000) this.unlock('champion');
    store.set('hits', this.totalHits);
    const rank = RANKS.find(([lim]) => this.score < lim)[1];
    this.say(newBest ? 'Новый рекорд! Ты ' + rank.toLowerCase() + '!' : 'Раунд окончен. Ты ' + rank.toLowerCase() + '!', true);
    setTimeout(() => {
      if (newBest) this.sound.cheer(2.5, 0.6);
      this.mode = 'results';
      this.ui.results({ score: this.score, hits: this.hits, maxCombo: this.maxCombo, best: this.best, rank, newBest });
    }, 1600);
  }
}
