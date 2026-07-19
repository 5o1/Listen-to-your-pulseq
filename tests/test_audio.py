"""Tests for pypulseq_audio — unit tests with mocked Sequence, integration with real pypulseq."""
import sys
import numpy as np
import pytest
from unittest.mock import MagicMock, patch


# ── Helpers to build mock Sequence objects ─────────────────────────────────

def _mock_trap_grad(amplitude=10.0, rise=100e-6, flat=500e-6, fall=100e-6, delay=0.0):
    """Create a mock trapezoid gradient event."""
    g = MagicMock()
    g.type = 'trap'
    g.amplitude = amplitude
    g.rise_time = rise
    g.flat_time = flat
    g.fall_time = fall
    g.delay = delay
    return g


def _mock_arb_grad(amplitude=10.0, first=0.0, last=0.0, delay=0.0,
                   waveform=None, tt=None, shape_dur=1e-3):
    """Create a mock arbitrary gradient event."""
    g = MagicMock()
    g.type = 'grad'
    g.amplitude = amplitude
    g.first = first
    g.last = last
    g.delay = delay
    g.waveform = waveform if waveform is not None else np.array([0.5, 1.0, 0.5])
    g.tt = tt if tt is not None else np.array([0.25e-3, 0.5e-3, 0.75e-3])
    g.shape_dur = shape_dur
    return g


def _make_seq(blocks, system_gamma=42.577e6):
    """Build a mock pypulseq.Sequence with given block structure."""
    seq = MagicMock()
    seq.block_events = dict(blocks)
    seq.system = MagicMock()
    seq.system.gamma = system_gamma
    seq.block_durations = {k: v for k, v in blocks.items()}
    return seq


# ── duration_update tests ──────────────────────────────────────────────────

class TestDurationUpdate:
    def test_first_call_append_only(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({1: 0.001, 2: 0.002, 3: 0.003})
        # Inject block_durations
        seq.block_durations = {1: 0.001, 2: 0.002, 3: 0.003}
        # Mock get_block to avoid real pypulseq dependency
        seq.get_block = MagicMock()

        result = duration_update(seq, append_only=True)
        assert result == 0.006
        assert hasattr(seq, '_duration_history')

    def test_append_only_incremental(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({1: 0.001, 2: 0.002})
        seq.block_durations = {1: 0.001, 2: 0.002}
        seq.get_block = MagicMock()

        duration_update(seq, append_only=True)  # first call
        # Simulate adding a block
        seq.block_events = {1: 0.001, 2: 0.002, 3: 0.004}
        seq.block_durations = {1: 0.001, 2: 0.002, 3: 0.004}

        result = duration_update(seq, append_only=True)
        assert result == 0.007

    def test_not_append_only_detects_addition(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({1: 0.001, 2: 0.002})
        seq.block_durations = {1: 0.001, 2: 0.002}
        seq.get_block = MagicMock()

        duration_update(seq, append_only=False)
        # Add a block
        seq.block_events = {1: 0.001, 2: 0.002, 3: 0.004}
        seq.block_durations = {1: 0.001, 2: 0.002, 3: 0.004}

        result = duration_update(seq, append_only=False)
        assert result == 0.007

    def test_switching_cache_mode_rebuilds_safely(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({1: 0.001, 2: 0.002})
        seq.block_durations = {1: 0.001, 2: 0.002}

        assert duration_update(seq, append_only=True) == 0.003
        assert duration_update(seq, append_only=False) == 0.003

    def test_empty_sequence_is_zero(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({})
        seq.block_durations = {}
        assert duration_update(seq, append_only=True) == 0.0

    def test_not_append_only_detects_removal(self):
        from pypulseq_audio.audio import duration_update
        seq = _make_seq({1: 0.001, 2: 0.002, 3: 0.003})
        seq.block_durations = {1: 0.001, 2: 0.002, 3: 0.003}
        seq.get_block = MagicMock()

        duration_update(seq, append_only=False)
        # Remove block 2
        seq.block_events = {1: 0.001, 3: 0.003}
        seq.block_durations = {1: 0.001, 3: 0.003}

        result = duration_update(seq, append_only=False)
        assert result == 0.004


# ── listen tests ───────────────────────────────────────────────────────────

class TestListen:
    def test_empty_buffer_returns_empty_array(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({})
        seq.get_block = MagicMock()
        seq.block_durations = {}

        result = listen(seq, play_now=False, time_range=(0, np.inf))
        assert isinstance(result, np.ndarray)
        assert len(result) == 0

    def test_trap_gradient_produces_waveform(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}

        block = MagicMock()
        block.gx = _mock_trap_grad(amplitude=10.0, rise=100e-6, flat=500e-6,
                                    fall=100e-6, delay=0.0)
        block.gy = None
        block.gz = None
        seq.get_block = MagicMock(return_value=block)

        result = listen(seq, play_now=False, time_range=(0, np.inf))
        assert len(result) > 0
        assert isinstance(result, np.ndarray)

    def test_arb_gradient_produces_waveform(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.002})
        seq.block_durations = {1: 0.002}

        block = MagicMock()
        block.gx = None
        block.gy = _mock_arb_grad(amplitude=5.0)
        block.gz = None
        seq.get_block = MagicMock(return_value=block)

        result = listen(seq, play_now=False, time_range=(0, np.inf))
        assert len(result) > 0

    def test_time_range_filters_blocks(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 1.0, 2: 1.0})
        seq.block_durations = {1: 1.0, 2: 1.0}

        block = MagicMock()
        block.gx = _mock_trap_grad(amplitude=10.0)
        block.gy = None
        block.gz = None
        seq.get_block = MagicMock(return_value=block)

        full = listen(seq, play_now=False, time_range=(0, np.inf))
        partial = listen(seq, play_now=False, time_range=(0, 0.5))
        assert len(partial) < len(full)

    def test_invalid_time_range_raises(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}
        seq.get_block = MagicMock()

        with pytest.raises(ValueError):
            listen(seq, time_range=(0, 1, 2))

    def test_multichannel_gradients_are_summed(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}

        block = MagicMock()
        block.gx = _mock_trap_grad(amplitude=10.0)
        block.gy = _mock_trap_grad(amplitude=20.0)
        block.gz = None
        seq.get_block = MagicMock(return_value=block)

        result = listen(seq, play_now=False, rate=10_000)
        assert np.max(result) == pytest.approx(0.03, abs=1e-6)

    def test_invalid_gradient_unit_and_rate_raise(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}
        seq.get_block = MagicMock()

        with pytest.raises(ValueError, match='gradient unit'):
            listen(seq, grad_disp='T/m')
        with pytest.raises(ValueError, match='positive integer'):
            listen(seq, rate=0)

    def test_save_path_alias_writes_wav(self, tmp_path):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}

        block = MagicMock()
        block.gx = _mock_trap_grad()
        block.gy = None
        block.gz = None
        seq.get_block = MagicMock(return_value=block)

        with pytest.warns(DeprecationWarning, match='save_path'):
            result = listen(seq, play_now=False, save_path=str(tmp_path))

        assert len(result) > 0
        assert (tmp_path / 'seq.wav').exists()

    def test_invalid_time_disp_raises(self):
        from pypulseq_audio.audio import listen
        seq = _make_seq({1: 0.001})
        seq.block_durations = {1: 0.001}
        seq.get_block = MagicMock()

        with pytest.raises(ValueError):
            listen(seq, time_disp='years')


# ── is_jupyter_notebook tests ──────────────────────────────────────────────

class TestJupyterDetection:
    def test_not_in_jupyter(self):
        from pypulseq_audio.audio import _is_jupyter_notebook
        assert _is_jupyter_notebook() is False

    def test_in_jupyter(self):
        with patch.dict(sys.modules, {'IPython': MagicMock()}):
            import IPython
            mock_shell = MagicMock()
            mock_shell.__class__.__name__ = 'ZMQInteractiveShell'
            IPython.get_ipython = MagicMock(return_value=mock_shell)

            from pypulseq_audio.audio import _is_jupyter_notebook
            assert _is_jupyter_notebook() is True

    def test_ipython_shell_none(self):
        with patch.dict(sys.modules, {'IPython': MagicMock()}):
            import IPython
            IPython.get_ipython = MagicMock(return_value=None)

            from pypulseq_audio.audio import _is_jupyter_notebook
            assert _is_jupyter_notebook() is False


# ── Integration test (requires pypulseq installed) ─────────────────────────

@pytest.mark.integration
class TestIntegration:
    def test_real_sequence_listen(self):
        """Test with a real pypulseq Sequence if available."""
        try:
            from pypulseq import Sequence, make_trapezoid
        except ImportError:
            pytest.skip("pypulseq not installed")

        import pypulseq_audio
        pypulseq_audio.patch()

        seq = Sequence()
        # Add a simple trapezoid gradient
        gx = make_trapezoid(channel='x', amplitude=10e3,
                                 rise_time=100e-6, flat_time=500e-6,
                                 fall_time=100e-6)
        seq.add_block(gx)

        # Should not crash
        waveform = seq.listen(play_now=False)
        assert len(waveform) > 0
        assert isinstance(waveform, np.ndarray)

    def test_duration_update(self):
        """Test duration_update with a real Sequence."""
        try:
            from pypulseq import Sequence, make_trapezoid
        except ImportError:
            pytest.skip("pypulseq not installed")

        import pypulseq_audio
        pypulseq_audio.patch()

        seq = Sequence()
        gx = make_trapezoid(channel='x', amplitude=10e3,
                                 rise_time=100e-6, flat_time=500e-6,
                                 fall_time=100e-6)
        seq.add_block(gx)

        dur = seq.duration_update()
        assert dur > 0
