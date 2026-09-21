"""
Ghost's voice. A tiny stdin/stdout worker around Chatterbox (Resemble AI, MIT),
which clones a voice from one short clip with no training step. The menu starts
this once, keeps it running, and sends one JSON request per line:

    {"id": "1", "text": "Launching Doctor Strange", "voice": "C:/.../ghost.wav", "out": "C:/.../abc.wav"}

and gets one JSON line back when the file is written:

    {"id": "1", "ok": true, "file": "C:/.../abc.wav"}

Everything runs on this machine; the model weights come from Hugging Face on the
first run and stay in the usual cache. CUDA is used when torch can see a GPU,
otherwise the CPU - slower, but the menu caches every phrase it has said.
"""

import json
import os
import sys
import traceback

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    emit({"status": "loading"})
    import torch
    import torchaudio as ta

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        # The published checkpoints were saved from CUDA tensors; on a CPU-only box
        # every torch.load has to be told where to put them.
        _load = torch.load

        def _cpu_load(*args, **kwargs):
            kwargs.setdefault("map_location", torch.device("cpu"))
            return _load(*args, **kwargs)

        torch.load = _cpu_load

    from chatterbox.tts import ChatterboxTTS

    model = ChatterboxTTS.from_pretrained(device=device)
    emit({"status": "ready", "device": device})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            if req.get("quit"):
                break
            with torch.inference_mode():
                wav = model.generate(
                    req["text"],
                    audio_prompt_path=req["voice"],
                    exaggeration=float(req.get("exaggeration", 0.5)),
                    cfg_weight=float(req.get("cfg", 0.5)),
                )
            ta.save(req["out"], wav, model.sr)
            emit({"id": req.get("id"), "ok": True, "file": req["out"]})
        except Exception as e:  # noqa: BLE001 - report every failure to the menu
            emit({"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "error": f"{e}", "trace": traceback.format_exc()[-800:]})


if __name__ == "__main__":
    main()
