import "core-js/stable";
import "regenerator-runtime/runtime";
import { html, render } from 'lit-html';
import { resumeAudioContext } from '@ircam/resume-audio-context';
import { AudioBufferLoader } from 'waves-loaders';
import '@ircam/simple-components/sc-button.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-text.js';

// console.log(basename);
const audioContext = new AudioContext();

const soundfiles = [
  './assets/kick.wav',
  './assets/snare.wav',
  './assets/clap.wav',
  './assets/hh.wav',
  './assets/rimshot.wav',
  './assets/give_you_up.wav',
  './assets/let_you_down.wav',
  './assets/run_around_and_hurt_you.wav',
];

const model = {};

const globals = {
  feedbackDelay: null,
}

function playSound(filename) {
  const buffer = model[filename].buffer;
  const volume = model[filename].volume;

  const env = audioContext.createGain();
  env.connect(globals.feedbackDelay.input); // @note this globals
  env.gain.value = volume;

  const src = audioContext.createBufferSource();
  src.connect(env);
  src.buffer = buffer;

  src.start();
}

// [students] ----------------------------
class FeedbackDelay {
  constructor(audioContext) {
    // <-----------------------------
    this.audioContext = audioContext;

    this._output = this.audioContext.createGain();

    this._feedback = this.audioContext.createGain();
    this.feedback = 0.9;

    this._delay = this.audioContext.createDelay();
    this.delayTime = 0.1;
    this._feedback.connect(this._delay);
    this._delay.connect(this._output);
    this._delay.connect(this._feedback);

    this._preGain = this.audioContext.createGain();
    this.preGain = 0.6;
    this._preGain.connect(this._delay);

    this.input = this.audioContext.createGain();
    this.input.connect(this._output);
    this.input.connect(this._preGain);
    // ---------------------------->
  }

  connect(outputNode) {
    // <-----------------------------
    this._output.connect(outputNode);
    // ---------------------------->
  }

  set preGain(value) {
    // <-----------------------------
    const now = this.audioContext.currentTime;
    // this._preGain.gain.value = value;
    this._preGain.gain.setTargetAtTime(value, now, 0.01);
    // ---------------------------->
  }

  get preGain() {
    // <-----------------------------
    return this._preGain.gain.value;
    // ---------------------------->
  }

  set delayTime(value) {
    // <-----------------------------
    const now = this.audioContext.currentTime;
    // this._delay.delayTime.value = value;
    this._delay.delayTime.setTargetAtTime(value, now, 0.01);
    // ---------------------------->
  }

  get delayTime() {
    // <-----------------------------
    return this._delay.delayTime.value;
    // ---------------------------->
  }

  set feedback(value) {
    // <-----------------------------
    // code
    const now = this.audioContext.currentTime;
    // this._feedback.gain.value = value;
    this._feedback.gain.setTargetAtTime(value, now, 0.01);
    // ---------------------------->
  }

  get feedback() {
    // <-----------------------------
    // code
    return this._feedback.gain.value;
    // ---------------------------->
  }

}

// -----------------------------
// ## Key points
// - understand the feedback delay graph
// - write a class that integrates properly w/ the WebAudio API
//
// ## Going further:
// - instantiate and control a FeedbackDelay for each node
// - create an `AudioBufferPlayer` class to play the sounds

// -----------------------------------------

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // 1. load sound files
  const loader = new AudioBufferLoader();
  const buffers = await loader.load(soundfiles);

  // 2. use the result and the `soundfile` Array to populate model[filename].buffers
  soundfiles.forEach((pathname, index) => {
    const filename = pathname.split('/')[2];

    model[filename] = {
      buffer: buffers[index],
      volume: 1,
    };
  });

  // 3. instantiate FeedbackDelay instante
  // <-----------------------------
  const feedbackDelay = new FeedbackDelay(audioContext);
  // ---------------------------->
  feedbackDelay.connect(audioContext.destination);
  // ---------------------------->
  // store it into globals so that playSound can access it
  globals.feedbackDelay = feedbackDelay;

  renderGUI();
}());

// GUI
function renderGUI() {
  const $main = document.querySelector('.main');

  render(html`
    <div style="margin-bottom: 10px; padding: 20px; border: 1px solid #565656">
      <h3>feedback delay controls</h3>
      <div style="padding-bottom: 4px;">
        <sc-text
          value="preGain"
          readonly
          width="100"
        ></sc-text>
        <sc-slider
          min="0"
          max="1"
          value="${globals.feedbackDelay.preGain}"
          @input=${e => globals.feedbackDelay.preGain = e.detail.value}
        ></sc-slider>
      </div>
      <div style="padding-bottom: 4px;">
        <sc-text
          value="delayTime"
          readonly
          width="100"
        ></sc-text>
        <sc-slider
          min="0"
          max="1"
          value="${globals.feedbackDelay.delayTime}"
          @input=${e => globals.feedbackDelay.delayTime = e.detail.value}
        ></sc-slider>
      </div>
      <div style="padding-bottom: 4px;">
        <sc-text
          value="feedback"
          readonly
          width="100"
        ></sc-text>
        <sc-slider
          min="0"
          max="1"
          value="${globals.feedbackDelay.feedback}"
          @input=${e => globals.feedbackDelay.feedback = e.detail.value}
        ></sc-slider>
      </div>
    </div>
    ${Object.keys(model).map(filename => {
      return html`
        <div style="padding-bottom: 4px">
          <sc-button
            value="${filename}"
            @input="${e => playSound(filename)}"
          ></sc-button>
          <sc-text
            value="volume"
            readonly
            width="100"
          ></sc-text>
          <sc-slider
            min="0"
            max="1"
            value="${model[filename].volume}"
            @input=${e => model[filename].volume = e.detail.value}
          ></sc-slider>
        </div>
      `
    })}
  `, $main);
}
