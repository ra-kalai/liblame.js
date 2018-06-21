window = this;

function _dvar(o, prop, val) {
  if (o[prop] === undefined)
    o[prop] = val;
}

function _is_webworker() {
  return window.document === undefined;
}

function _async_init(className, attr) {
  this.worker = new Worker(attr.async);
  var worker = this.worker;
  worker.cb_queue = [];

  worker.onmessage = function (e) {
    (worker.cb_queue.shift())(e.data);
  };

  // construct in webworker
  this.worker.postMessage(['constructor', className, attr]);

  this.appendChunk = function (payload, after) {
    worker.postMessage(['appendChunk', payload]);
    worker.cb_queue.push(after);
  };

  this.destroy = function () {
    worker.terminate();
  };

  return this;
}

function Mp3Decoder(attr) {
  attr = attr || {};
  _dvar(attr, 'async', false);

  if (window.Worker && attr.async) {
    if (!_is_webworker()) {
      return _async_init.bind(this)('Mp3Decoder', attr);
    }
  }

  this.init(attr);

  return this;
}


function Mp3Encoder(attr) {
  attr = attr || {};
  _dvar(attr, 'async', true);

  if (window.Worker && attr.async === true) {
    if (!_is_webworker()) {
      return _async_init.bind(this)('Mp3Encoder', attr);
    }
  }

  this.init(attr);

  return this;
}

if (_is_webworker()) {
  var obj;
  onmessage = function (e) {
    var data = e.data;
    if (data[0] === 'constructor') {
      obj = new window[data[1]](data[2]);
    } else {
      obj[data[0]](data[1], function (ret) {
        postMessage(ret);
      });
    }
  };
}


(function () {
  function _arrayToHeap(typedArray){
    var numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
    var ptr = Module._malloc(numBytes);
    var heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
    heapBytes.set(new Uint8Array(typedArray.buffer));
    return heapBytes;
  }

  /* decoding mp3 */
  var hip_decode_init = Module.cwrap('hip_decode_init',
    'number',
    []
  );

  var hip_decode1 = Module.cwrap('hip_decode1',
    'number', // return type
    ['number', 'number', 'number', 'number', 'number']
  );

  Mp3Decoder.prototype.init = function () {
    this.hip_handle = hip_decode_init();
  };

  Mp3Decoder.prototype.appendChunk = function (mp3chunk, after) {
    var mp3len = mp3chunk.length;
    var pcmL = new Uint8Array(2000*2);
    var pcmR = new Uint8Array(2000*2);

    var pcmLB = _arrayToHeap(pcmL);
    var pcmRB = _arrayToHeap(pcmR);
    var mp3B = _arrayToHeap(mp3chunk);

    var ret = hip_decode1(this.hip_handle, mp3B.byteOffset, mp3len, pcmLB.byteOffset, pcmRB.byteOffset);

    var left;
    var right;
    if (ret>1) {
      left = new Int16Array(pcmLB.buffer, pcmLB.byteOffset, ret);
      left = new Int16Array(left);

      right = new Int16Array(pcmRB.buffer, pcmRB.byteOffset, ret);
      right = new Int16Array(right);
    } else {
      left = new Int16Array();
      right = new Int16Array();
    }

    Module._free(mp3B.byteOffset);
    Module._free(pcmLB.byteOffset);
    Module._free(pcmRB.byteOffset);

    after([left, right]);
  };

  /* encoding mp3 */
  var lame_init = Module.cwrap('lame_init',
    'number',
    []
  );

  var lame_close = Module.cwrap('lame_close',
    'number',
    ['number']
  );

  var lame_set_in_samplerate = Module.cwrap('lame_set_in_samplerate',
    'number',
    ['number', 'number']
  );

  var lame_set_VBR = Module.cwrap('lame_set_VBR',
    'number',
    ['number', 'number']
  );

  var lame_init_params = Module.cwrap('lame_init_params',
    'number',
    ['number']
  );

  var lame_set_disable_reservoir = Module.cwrap('lame_set_disable_reservoir',
    'number',
    ['number', 'number']
  );

  var lame_set_mode = Module.cwrap('lame_set_mode',
    'number',
    ['number', 'number']
  );

  var lame_set_brate = Module.cwrap('lame_set_brate',
    'number',
    ['number', 'number']
  );

  var lame_encode_buffer = Module.cwrap('lame_encode_buffer',
    'number',
    ['number','number','number','number','number','number']
  );

  Mp3Encoder.prototype.available_vbr_mode = {
    vbr_off: 0,
    vbr_mt: 1,
    vbr_rh: 2,
    vbr_abr: 3,
    vbr_mtrh: 4,
    vbr_default: 4
  };

  Mp3Encoder.prototype.available_mpg_mode =  {
    STEREO: 0,
    JOINT_STEREO: 1,
    DUAL_CHANNEL: 2,   /* LAME doesn't supports this! */
    MONO: 3
  };

  Mp3Encoder.prototype.init = function (attr) {
    _dvar(attr, 'samplerate', 44100);
    _dvar(attr, 'mpg_mode', this.available_mpg_mode.MONO);
    _dvar(attr, 'vbr_mode', this.available_vbr_mode.vbr_off);
    _dvar(attr, 'brate', -1);
    _dvar(attr, 'disable_bit_reservoir', 0);

    this.lame = lame_init();
    lame_set_in_samplerate(this.lame, attr.samplerate);
    lame_set_VBR(this.lame, attr.vbr_mode);
    if (attr.brate !== -1) {
      lame_set_brate(this.lame, attr.brate);
    }
    lame_set_mode(this.lame, attr.mpg_mode);
    lame_set_disable_reservoir(this.lame, attr.disable_bit_reservoir);
    lame_init_params(this.lame);
  };

  Mp3Encoder.prototype.destroy = function () {
    lame_close(this.lame);
  };

  Mp3Encoder.prototype.appendChunk = function (pcm, after) {
    var mp3B = _arrayToHeap(new Uint8Array(2048));
    var pcmLB = _arrayToHeap(pcm[0]);
    var pcmRB = _arrayToHeap(pcm[1]);

    var ret = lame_encode_buffer(this.lame, pcmLB.byteOffset, pcmRB.byteOffset, pcmLB.length/2, mp3B.byteOffset, 2048);

    var arr;
    if (ret>0) {
      arr = new Uint8Array(mp3B.buffer, mp3B.byteOffset, ret);
      arr = new Uint8Array(arr);
    } else {
      arr = new Uint8Array();
    }

    Module._free(mp3B.byteOffset);
    Module._free(pcmLB.byteOffset);
    Module._free(pcmRB.byteOffset);

    after(arr);
  };

  // var mp3enc = new Mp3Encoder({brate: 16, disable_bit_reservoir: 1, async: true});
  // var buf0 = new Uint8Array(1152);
  // var buf1 = new Uint8Array(1152);
  // var i;
  // for (i=0;i<buf0.length;i++) {
  //   buf0[i] = i%256;
  //   buf1[i] = 0;
  // }

  // for(i=0;i<20;i++) {
  //   mp3enc.appendChunk([buf0, buf1], function (d) {
  //     var b = i;
  //     console.log(b, d.length);
  //   });
  // }
  //console.log(1,mp3enc.appendChunk(buf0, buf0));
  //console.log(2,mp3enc.appendChunk(buf0, buf0));
  //console.log(3,mp3enc.appendChunk(buf0, buf0));
})();
