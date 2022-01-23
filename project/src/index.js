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
const audioFile = './assets/drum-loop.wav';
// const audioFile = './assets/hendrix.wav';
// const audioFile = './assets/cherokee.wav';

const globals = {
  buffer: null,
  synth: null,
  scheduler: null,
  guiPosition: { x: null, y: null }, // normalized position in the interface
}

const data = {
  blockStarts: [],
  sampleRate: null,
  rms: [], // list of RMS values for each block
  zeroCrossing: [],
  // we need normalized values for the interface and search
  normX: [], // list of normalized values according to one of the analysis
  normY: [], // list of normalized values according to another analysis
}

const BLOCK_SIZE = 2048;
const HOP_SIZE = 512;

/**
 * returns an Array of the blocks start times IN SAMPLES from the given audio signal
 * if the last block is < blockSize, just ignore it
 * @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
 * @param {Number} blockSize - Size of the block to perform the analysis (in sample)
 * @param {Number} hopSize - Size of hop between two consecutive blocks
 * @returns {Int32Array}
 */
function getBlockStarts(channelData, blockSize, hopSize) {
  // first compute the last block to be wholly included in channelData
  const stopBlockIdx = Math.floor((channelData.length - blockSize) / hopSize);
  // then just create the array of [0, hopSize, 2*hopSize, ..., stopBlockIdx*hopSize].
  const startBlocks = [...Array(stopBlockIdx).keys()].map(v => v * hopSize);
  return startBlocks;
}

/**
 * Splice audio data in blocks.
 * Each block[idx] starts at times[idx] and is of length blockSize.
 * @param {Float32Array} channelData - PCM data from the AudioBuffer (assume mono)
 * @param {Number} blockSize - Size of the block to perform the analysis (in sample)
 * @param {Int32Array} times - Start time of each block.
 * @returns {Array<Float32Array>}
 */
function getBlocks(channelData, blockSize, times) {
  const blocks = Array.from(times, startBlock => channelData.slice(startBlock, startBlock + blockSize));
  return blocks;
}

/**
 * returns the audio RMS power of the given audio blocks
 * @param {Float32Array} block - Sample blocks
 * @returns {Number}
 */
function rms(block) {
  // root of the mean square
  return Math.sqrt(block.map(sample => sample * sample).reduce((p, c) => p + c) / block.length);
}

/**
 * returns an estimation of the pitch / noisiness (in Hz) using zero-crossing
 *  from the given blocks
 * @param {Float32Array} block - Sample block
 * @param {Number} sampleRate - Sample rate of the given audio data
 * @returns 
 */
function zeroCrossing(block, sampleRate) {
  // count zeroes in block.
  // first computed shifted array
  const blockShiftLeft = [...block];
  const blockShiftRight = [...block];
  blockShiftLeft.shift();
  blockShiftRight.pop();
  // count times when next values changed signs
  const blockCross = blockShiftLeft.map((left, idx) => Math.abs(Math.sign(left) - Math.sign(blockShiftRight[idx])) / 2);

  return blockCross.filter(cross => cross != 0).length * sampleRate;
}

/**
 * normalize given `data` array according to its min and max
 * @param {Float32Array} arr * Array of the data to normalize
 * @returns 
 */
function normalize(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return arr.map(el => (el - min) / (max - min));
}

function findStartTimeFromGuiPosition(guiPosition, data) {
  const mx = guiPosition.x;
  const my = guiPosition.y;
  const xs = data.normX;
  const ys = data.normY;
  const dist = xs.map((x, idx) => (x - mx) ** 2 + (ys[idx] - my) ** 2);
  // get index of the features with smallest distance of from the mouse
  // using argmin
  // see: https://stackoverflow.com/a/30850912
  const blockIdx = dist.reduce((minIdx, el, idx, arr) => el < arr[minIdx] ? idx : minIdx, 0);
  return data.blockStarts[blockIdx] / data.sampleRate;
}

// [students] ----------------------------------------
class ConcatEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.period = 0.05; // period of the grains
    this.duration = 0.2; // duration of the grains

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

  /**
   * 
   * @param {Number} currentTime 
   * @param {Number} audioTime 
   * @param {Number} dt 
   * @returns 
   */
  advanceTime(currentTime, audioTime, dt) {
    // this should retrieve a position in the buffer (in sec) according to
    // the position in the interface and to the analysis
    const guiPosition = globals.guiPosition;
    // don't play sound if mouse if released.
    if (guiPosition.x === null || guiPosition.y == null) {
      return currentTime + this.period;
    }

    const bufferStartTime = findStartTimeFromGuiPosition(guiPosition, data);
    // add some jitter to avoid audible artifact due to period
    const grainTime = audioTime + Math.random() * 0.005;
    console.log(guiPosition, bufferStartTime);

    // fire and forget the grain
    const env = this.audioContext.createGain();
    env.gain.value = 0;
    env.connect(this.output);

    const src = this.audioContext.createBufferSource();
    src.buffer = this.buffer;
    src.connect(env);

    // triangle ramp
    env.gain.setValueAtTime(0, grainTime);
    env.gain.linearRampToValueAtTime(1, grainTime + this.duration / 2);
    env.gain.linearRampToValueAtTime(0, grainTime + this.duration);

    src.start(grainTime, bufferStartTime);
    src.stop(grainTime + this.duration);

    return currentTime + this.period;
  }
}

(async function main() {
  // resume audio context
  await resumeAudioContext(audioContext);

  // [students] ----------------------------------------
  // 1. load audio file
  const loader = new AudioBufferLoader();
  const buffer = await loader.load(audioFile);
  const channelData = buffer.getChannelData(0); // assume the buffer is mono
  const sampleRate = buffer.sampleRate;
  // 2. perform analysis and store results in `data`
  const blockStarts = getBlockStarts(channelData, BLOCK_SIZE, HOP_SIZE);
  const blocks = getBlocks(channelData, BLOCK_SIZE, blockStarts);
  const blockRms = blocks.map(block => rms(block));
  const blockZcr = blocks.map(block => zeroCrossing(block, sampleRate));
  //
  data.sampleRate = sampleRate
  data.blockStarts = blockStarts;
  data.rms = blockRms;
  data.zeroCrossing = blockZcr;
  // 3. compute normalized analysis for GUI and search
  data.normX = normalize(blockRms);
  data.normY = normalize(blockZcr);
  // 4. create scheduler
  const scheduler = new Scheduler(() => audioContext.currentTime);
  // 5. create concat engine
  const synth = new ConcatEngine(audioContext);
  synth.buffer = buffer;
  synth.connect(audioContext.destination);
  // 6. add engine to scheduler
  scheduler.add(synth); // start granular engine

  console.log(data);

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

