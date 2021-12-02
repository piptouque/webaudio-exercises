import "core-js/stable";
import "regenerator-runtime/runtime";
import { html, render } from 'lit-html';
import { resumeAudioContext } from '@ircam/resume-audio-context';
import { Scheduler } from 'waves-masters';
import { AudioBufferLoader } from 'waves-loaders';
import '@ircam/simple-components/sc-text.js';
import '@ircam/simple-components/sc-slider.js';
import '@ircam/simple-components/sc-button.js';
// import '@ircam/simple-components/sc-surface.js';
import '@ircam/simple-components/sc-dot-map.js';

const audioContext = new AudioContext();
// const audioFile = './assets/ligeti-artikulation.wav';
// const audioFile = './assets/drum-loop.wav';
const audioFile = './assets/hendrix.wav';
// const audioFile = './assets/cherokee.wav';

const globals = {
  buffer: null,
  synth: null,
  scheduler: null,
  guiPosition: { x: null, y: null }, // normalized position in the interface
}

const data = {
  times: [],
  rms: [], // list of RMS values for each block
  zeroCrossing: [],
  // we need normalized values for the interface and search
  normX: [], // list of normalized values according to one of the analysis
  normY: [], // list of normalized values according to another analysis
}

const BLOCK_SIZE = 2048;
const HOP_SIZE = 512;

// returns an Array of the blocks start times from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in sample)
// @param {Number} hopSize - Size of hop between two consecutive blocks
// @return {Array}
function getTimes(channelData, sampleRate, blockSize, hopSize) {
  const bufferLength = channelData.length;
  const result = [];

  for (let i = 0; i < bufferLength; i += hopSize) {
    const startSample = i;
    const endSample = i + blockSize;

    // ignore last block if < blockSize
    if (endSample <= bufferLength) {
      const time = startSample / sampleRate;
      result.push(time);
    }
  }

  return result;
}

// returns an Array of zero-crossing values from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in sample)
// @param {Number} hopSize - Size of hop between two consecutive blocks
// @return {Array}
function rms(channelData, sampleRate, blockSize, hopSize) {
  const bufferLength = channelData.length;
  const result = [];

  for (let i = 0; i < bufferLength; i += hopSize) {
    const startSample = i;
    const endSample = i + blockSize;

    // ignore last block if < blockSize
    if (endSample <= bufferLength) {
      let sumOfSquared = 0; // sum of samples in the block

      for (let j = startSample; j < endSample; j++) {
        sumOfSquared += (channelData[j] * channelData[j]);
      }

      let mean = sumOfSquared / blockSize;
      let rms = Math.sqrt(mean);
      result.push(rms);
    }
  }

  return result;
}

// returns an estimation of the pitch / noisiness (in Hz) using zero-crossing
// from the given audio signal
// if the last block is < blockSize, just ignore it
// @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
// @param {Number} sampleRate - sample rate of the given audio data
// @param {Number} blockSize - Size of the block to perform the analysis (in sample)
// @param {Number} hopSize - Size of hop between two consecutive blocks
// @return {Array}
function zeroCrossing(channelData, sampleRate, blockSize, hopSize) {
  const bufferLength = channelData.length;
  const result = [];

  for (let i = 0; i < bufferLength; i += hopSize) {
    const startSample = i;
    const endSample = i + blockSize;
    const blockDuration = blockSize / sampleRate;

    // ignore last block if < blockSize
    if (endSample <= bufferLength) {
      let count = 0; // sum of samples in the block

      // `endSample - 1` because we compare 2 consecutive samples
      for (let j = startSample; j < endSample - 1; j++) {
        const current = channelData[j];
        const next = channelData[j + 1];

        // these two samples are of different signs
        if (current * next < 0) {
          count += 1;
        }
      }

      const zc = count / blockDuration; // is this correct?
      result.push(zc);
    }
  }

  return result;
}

// normalize given `data` array according to its min and max
// @param {Array} data - Array of the data to normalize
// @return {Array}
function normalize(data) {
  let min = +Infinity;
  let max = -Infinity;
  let result = [];
  // find min and max
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) {
      min = data[i];
    }

    if (data[i] > max)  {
      max = data[i];
    }
  }

  for (let i = 0; i < data.length; i++) {
    result[i] = (data[i] - min) / (max - min);
  }

  return result;
}

function findStartTimeFromGuiPosition(guiPosition, data) {
  const { x, y } = guiPosition;
  const { times, normX, normY } = data;
  let minDistance = +Infinity;
  let closestIndex = null; // index of the chunk that is closer to our gui point

  for (let i = 0; i < times.length; i++) {
    const distX = normX[i] - x;
    const distY = normY[i] - y;
    const distance = Math.sqrt(distX * distX + distY * distY);

    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return times[closestIndex];
}

// [students] ----------------------------------------
class ConcatEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.period = 0.05; // period of the grains
    this.duration = 0.2; // duration of the grains
    this._position = 0; // position in the buffer

    this.output = audioContext.createGain();
  }

  connect(output) {
    this.output.connect(output);
  }

  set buffer(value) {
    this._buffer = value;
  }

  get buffer() {
    return this._buffer;
  }

  advanceTime(currentTime, audioTime, dt) {
    // this should retrieve a position in the buffer (in sec) according to
    // the position in the interface and to the analysis
    const guiPosition = globals.guiPosition;
    // don't play sound of interaction is released
    if (guiPosition.x === null && guiPosition.y == null) {
      return currentTime + this.period;
    }

    const positionInBuffer = findStartTimeFromGuiPosition(guiPosition, data);
    // add some jitter to avoid audible artifact due to period
    const grainTime = audioTime + Math.random() * 0.005;

    // fire and forget the grain
    const env = this.audioContext.createGain();
    env.gain.value = 0;
    env.connect(this.output);

    const src = this.audioContext.createBufferSource();
    src.buffer = this.buffer;
    src.connect(env);

    // triangle ramp
    env.gain.setValueAtTime(0., grainTime);
    env.gain.linearRampToValueAtTime(1., grainTime + this.duration / 2);
    env.gain.linearRampToValueAtTime(0., grainTime + this.duration);

    src.start(grainTime, positionInBuffer);
    src.stop(grainTime + this.duration);

    return currentTime + this.period;
  }
}

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // [students] ----------------------------------------
  // load audio file
  const loader = new AudioBufferLoader();
  const buffer = await loader.load(audioFile);

  // perform analysis and store results in `data`
  const channelData = buffer.getChannelData(0); // assume the buffer is mono
  const sampleRate = buffer.sampleRate;
  data.times = getTimes(channelData, sampleRate, BLOCK_SIZE, HOP_SIZE);
  data.rms = rms(channelData, sampleRate, BLOCK_SIZE, HOP_SIZE);
  data.zeroCrossing = zeroCrossing(channelData, sampleRate, BLOCK_SIZE, HOP_SIZE);

  // compute normalized analysis for GUI and search
  data.normX = normalize(data.zeroCrossing);
  data.normY = normalize(data.rms);

  // create scheduler
  const getTimeFunction = () => audioContext.currentTime;
  const scheduler = new Scheduler(getTimeFunction);

  // create granular engine
  const synth = new ConcatEngine(audioContext);
  synth.buffer = buffer;
  synth.connect(audioContext.destination);

  synth.position = 1;
  console.log(buffer.duration, synth.position);

  scheduler.add(synth); // start granular engine
  // ![students] ----------------------------------------

  globals.buffer = buffer;
  globals.scheduler = scheduler;
  globals.synth = synth;
  // @see interface to see to interact w/ the synth and the scheduler
  renderGUI();
}());

// GUI
function renderGUI() {
  const $main = document.querySelector('.main');
  const dots = [];
  for (let i = 0; i < data.normX.length; i++) {
    const dot = { x: data.normX[i], y: data.normY[i] }
    dots.push(dot);
  }

  render(html`
    <div style="padding-bottom: 4px;">
      <sc-text
        value="period"
        readonly
      ></sc-text>
      <sc-slider
        value="${globals.synth.period}"
        min="0.01"
        max="0.2"
        width="500"
        display-number
        @input="${e => globals.synth.period = e.detail.value}"
      ></sc-slider>
    </div>
    <div style="padding-bottom: 4px;">
      <sc-text
        value="duration"
        readonly
      ></sc-text>
      <sc-slider
        value="${globals.synth.duration}"
        min="0"
        max="1"
        width="500"
        display-number
        @input="${e => globals.synth.duration = e.detail.value}"
      ></sc-slider>
    </div>
    <!-- insert new sliders there -->

    <div style="position: absolute">
      <sc-dot-map
        style="position: absolute; top: 0; left: 0"
        width="500"
        height="500"
        color="white"
        radius="2"
        y-range="[1, 0]"
        value="${JSON.stringify(dots)}"
      ></sc-dot-map>
      <sc-dot-map
        style="position: absolute; top: 0; left: 0"
        width="500"
        height="500"
        background-color="transparent"
        y-range="[1, 0]"
        capture-events
        @input="${e => {
          if (e.detail.value.length) {
            globals.guiPosition.x = e.detail.value[0].x;
            globals.guiPosition.y = e.detail.value[0].y;
          } else {
            globals.guiPosition.x = null;
            globals.guiPosition.y = null;
          }
        }}"
      ></sc-dot-map>
    </div>
  `, $main);
}

