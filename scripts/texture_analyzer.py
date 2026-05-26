"""
Pixel-based texture channel analyzer.

Opens texture images, downsamples to 64x64, and detects channel content
by analyzing mean/std per channel. Identifies:

  - Normal maps (bluish G~0.5, B>0.8)
  - ORM packed  (R=ao, G=roughness, B=metallic)
  - Grayscale maps (roughness, metallic, ao, displacement)
  - sRGB albedo/diffuse maps
  - Emission maps (hot channel peaks)
  - Alpha/opacity masks
  - Constant / uniform textures
"""

import os
import numpy as np

try:
    from PIL import Image
except ImportError:
    Image = None

# Detection thresholds
NORMAL_B_MIN = 0.75
NORMAL_G_MIN = 0.40
NORMAL_G_MAX = 0.65
ORM_STD_MIN = 0.04
ORM_MEAN_LOW = 0.05
ORM_MEAN_HIGH = 0.95
GRAYSCALE_STD_MIN = 0.03

CHANNEL_LABELS = ["R", "G", "B", "A"]


def _load_and_downsample(path, max_size=64):
    """Load image, convert to RGBA float32, downsample to at most max_size."""
    img = Image.open(path)
    w, h = img.size
    mode = img.mode
    has_alpha = "A" in mode

    if w > max_size or h > max_size:
        ratio = max_size / max(w, h)
        img = img.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.LANCZOS)

    arr = np.array(img.convert("RGBA"), dtype=np.float32) / 255.0
    return arr, mode, has_alpha, w, h


def analyze(path):
    """Analyze a texture file and return dict with detected channel info."""
    if Image is None:
        return None
    if not os.path.isfile(path):
        return None

    try:
        arr, mode, has_alpha, orig_w, orig_h = _load_and_downsample(path)
    except Exception:
        return None

    channels = {}
    for i, name in enumerate(CHANNEL_LABELS):
        chan = arr[:, :, i]
        channels[name] = {
            "mean": float(round(chan.mean(), 4)),
            "std":  float(round(chan.std(), 4)),
            "min":  float(round(chan.min(), 4)),
            "max":  float(round(chan.max(), 4)),
        }

    classification = _classify(channels, has_alpha, mode)

    return {
        "orig_width": orig_w,
        "orig_height": orig_h,
        "mode": mode,
        "has_alpha": has_alpha,
        "channels": channels,
        "classification": classification,
        "is_constant": all(ch["std"] < 0.015 for ch in channels.values()),
        "resolution_kb": round(os.path.getsize(path) / 1024, 1) if os.path.exists(path) else 0,
    }


def _classify(ch, has_alpha, mode):
    """Determine texture type and per-channel meaning from pixel statistics."""
    r, g, b = ch["R"], ch["G"], ch["B"]
    a = ch.get("A", {"mean": 1.0, "std": 0})

    r_m, g_m, b_m = r["mean"], g["mean"], b["mean"]
    r_s, g_s, b_s = r["std"], g["std"], b["std"]

    def is_grayscale():
        return max(abs(r_m - g_m), abs(g_m - b_m), abs(b_m - r_m)) < 0.03

    # Constant / uniform
    if all(ch[c]["std"] < 0.015 for c in ["R", "G", "B"]):
        if is_grayscale():
            if r_m < 0.05:
                return _cls("black", "Black/empty mask", {"R": "mask", "G": "mask", "B": "mask"})
            elif r_m > 0.95:
                return _cls("white", "White/full mask", {"R": "mask", "G": "mask", "B": "mask"})
            return _cls("uniform_grey", f"Uniform grey (mean={r_m:.2f})", {"R": "grayscale", "G": "grayscale", "B": "grayscale"})
        return _cls("uniform_color", f"Uniform color ({r_m:.2f},{g_m:.2f},{b_m:.2f})",
                    {"R": "color", "G": "color", "B": "color"})

    # Normal map (B > 0.75, G ~ 0.5, R varies independently)
    if b_m > NORMAL_B_MIN and NORMAL_G_MIN < g_m < NORMAL_G_MAX and b_s > 0.02 and r_s > 0.03:
        return _cls("normal", "Normal map (B=Z, G=Y, R=X)",
                    {"R": "normal_x", "G": "normal_y", "B": "normal_z"}, confidence="high")

    # Grayscale BEFORE ORM (pure grayscale is not ORM)
    if is_grayscale() and r_s > GRAYSCALE_STD_MIN:
        mu = r_m
        if mu < 0.15:
            return _cls("metallic_or_mask", f"Dark grayscale (mean={mu:.2f}) — metallic or mask",
                        {"R": "grayscale", "G": "grayscale", "B": "grayscale"})
        elif mu > 0.85:
            return _cls("light_grayscale", f"Light grayscale (mean={mu:.2f}) — roughness or specular",
                        {"R": "grayscale", "G": "grayscale", "B": "grayscale"})
        return _cls("mid_grayscale", f"Mid grayscale (mean={mu:.2f}) — roughness or ao",
                    {"R": "grayscale", "G": "grayscale", "B": "grayscale"})

    # ORM packed — each channel must be decorrelated (wider spread than albedo)
    # Albedo has all channels varying together (correlated); ORM channels are independent
    if all(ORM_MEAN_LOW < ch[c]["mean"] < ORM_MEAN_HIGH for c in ["R", "G", "B"]):
        if all(ch[c]["std"] > ORM_STD_MIN for c in ["R", "G", "B"]):
            spread = max(r_m, g_m, b_m) - min(r_m, g_m, b_m)
            # Check channel decorrelation: if R,G,B means are close, check per-channel std
            # ORM channels have different info; std ratio between max/min channel should be < 4
            std_vals = [ch[c]["std"] for c in ["R", "G", "B"]]
            std_ratio = max(std_vals) / max(min(std_vals), 0.001)
            if spread > 0.20 and std_ratio < 4.0:
                return _cls("orm", "Packed ORM (AO=R, Rough=G, Metal=B)",
                            {"R": "ao", "G": "roughness", "B": "metallic"}, confidence="high")

    # Emission / glow
    bright_peak = max(r_m, g_m, b_m)
    dark_valley = min(r_m, g_m, b_m)
    if bright_peak > 0.7 and (bright_peak - dark_valley) > 0.3:
        return _cls("emission", f"Emission/glow map (peak={bright_peak:.2f})",
                    {"R": "emission", "G": "emission", "B": "emission"}, confidence="medium")

    # Alpha / opacity
    if has_alpha and a["std"] > 0.02:
        return _cls("alpha_mask", "Has alpha channel (opacity/mask)",
                    per_channel={"A": "opacity"}, confidence="high")

    # sRGB albedo — multiple channels vary
    colorful = sum(1 for c in ["R", "G", "B"] if ch[c]["std"] > 0.08)
    if colorful >= 2:
        return _cls("albedo", f"Colorful texture ({colorful}/3 channels vary) — albedo/diffuse",
                    {"R": "albedo", "G": "albedo", "B": "albedo"}, confidence="medium")

    return _cls("unknown", f"R={r_m:.2f} G={g_m:.2f} B={b_m:.2f} — unclassified",
                per_channel=None, confidence="low")


def _cls(cls_type, desc, per_channel, confidence="auto"):
    return {
        "type": cls_type,
        "description": desc,
        "per_channel": per_channel,
        "confidence": confidence,
    }
