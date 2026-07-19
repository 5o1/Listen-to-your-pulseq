"""
pypulseq_audio - Audio preview for pypulseq gradient waveforms.

Usage:
    import pypulseq_audio
    pypulseq_audio.patch()  # opt-in monkey-patch

    # Or use the functions directly:
    from pypulseq_audio import listen, duration_update
"""

from .audio import listen, duration_update, _listentoyourpulseq_patch as patch

__all__ = ['listen', 'duration_update', 'patch']
