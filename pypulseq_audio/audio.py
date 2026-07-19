import os
import warnings
from typing import Callable, Optional, Tuple

import numpy as np

from pypulseq import Sequence
from scipy.io.wavfile import write


def _is_jupyter_notebook() -> bool:
    """Detect whether the current Python process is running inside a Jupyter notebook."""
    try:
        from IPython import get_ipython
        shell = get_ipython()
        if shell is None:
            return False
        class_name = shell.__class__.__name__
        return class_name == 'ZMQInteractiveShell'
    except Exception:
        return False


def _cumsum(*args: float) -> np.ndarray:
    """Cumulative sum of the given arguments, starting from the first value."""
    return np.cumsum(args)


def duration_update(self: Sequence, append_only: bool = True) -> float:
    """Return the total sequence duration, reusing cached block information."""
    block_events = self.block_events
    block_durations = self.block_durations

    if '_duration_history' not in vars(self):
        duration = float(sum(block_durations.get(key, 0.0) for key in block_events))
        if append_only:
            last_key = next(reversed(block_events), None)
            self._duration_history = (duration, last_key, dict(block_durations))
        else:
            self._duration_history = (duration, dict(block_events), dict(block_durations))
        return duration

    history = self._duration_history
    history_is_append_only = not isinstance(history[1], dict)
    if append_only != history_is_append_only:
        del self._duration_history
        return duration_update(self, append_only=append_only)

    duration = float(history[0])
    if append_only:
        start_key = history[1]
        keys = list(block_events)
        if not keys:
            self._duration_history = (0.0, None, {})
            return 0.0
        try:
            start_index = keys.index(start_key)
        except ValueError:
            # The append-only contract was violated; rebuild from scratch.
            duration = float(sum(block_durations.get(key, 0.0) for key in keys))
            start_index = len(keys) - 1
        for key in keys[start_index + 1:]:
            duration += block_durations.get(key, 0.0)
        self._duration_history = (duration, keys[-1], dict(block_durations))
        return duration

    old_events = history[1]
    old_durations = history[2] if len(history) > 2 else {}
    new_events = dict(block_events)
    new_durations = dict(block_durations)

    for key in new_events.keys() - old_events.keys():
        duration += new_durations.get(key, 0.0)
    for key in old_events.keys() - new_events.keys():
        duration -= old_durations.get(key, 0.0)

    from pypulseq.calc_duration import calc_duration
    for key in new_events.keys() & old_events.keys():
        events_changed = not np.array_equal(new_events[key], old_events[key])
        duration_changed = not np.isclose(
            new_durations.get(key, 0.0), old_durations.get(key, 0.0)
        )
        if events_changed:
            new_duration = float(calc_duration(self.get_block(key)))
            duration += new_duration - old_durations.get(key, 0.0)
            new_durations[key] = new_duration
        elif duration_changed:
            duration += new_durations.get(key, 0.0) - old_durations.get(key, 0.0)

    self._duration_history = (duration, new_events, new_durations)
    return duration


def listen(
    self: Sequence,
    speaker: Optional[Callable] = None,
    save_dir: Optional[str] = None,
    save_filename: str = 'seq.wav',
    time_range: Tuple[float, float] = (0.0, np.inf),
    time_disp: str = 's',
    grad_disp: str = 'kHz/m',
    play_now: bool = True,
    rate: int = 44100,
    save_path: Optional[str] = None,
) -> np.ndarray:
    """
    Listen to the gradient waveform of the sequence.

    Parameters
    ----------
    self : Sequence
        The sequence object.
    speaker : callable, optional
        A callable with signature (waveform: np.ndarray, rate: int) that plays
        audio. If None and running in Jupyter, IPython.display.Audio is used.
    save_dir : str, optional
        Directory path to save the waveform as a .wav file. The file is named
        according to `save_filename`.
    save_filename : str, optional
        Filename for the saved .wav file. Default is 'seq.wav'.
    time_range : tuple, optional
        The time range to listen to, in seconds. Default is (0, np.inf).
    time_disp : str, optional
        Deprecated compatibility option. ``time_range`` is always interpreted
        in seconds. Default is 's'.
    grad_disp : str, optional
        The gradient unit for the waveform. Default is 'kHz/m'.
    play_now : bool, optional
        Whether to play the audio immediately. Default is True.
    rate : int, optional
        The sample rate for the audio. Default is 44100.
    save_path : str, optional
        Deprecated alias for ``save_dir`` retained for compatibility with
        earlier releases.

    Returns
    -------
    waveform : np.ndarray
        The waveform of the sequence.
    """
    if save_path is not None:
        if save_dir is not None:
            raise ValueError('Use only one of save_dir and save_path')
        warnings.warn(
            'save_path is deprecated; use save_dir instead',
            DeprecationWarning,
            stacklevel=2,
        )
        save_dir = save_path

    in_jupyter = _is_jupyter_notebook()
    if speaker is None and in_jupyter:
        from IPython.display import Audio
        speaker = Audio

    valid_time_units = ['s', 'ms', 'us']
    valid_grad_units = ['kHz/m', 'mT/m']
    if (not isinstance(time_range, (tuple, list)) or len(time_range) != 2
            or not all(isinstance(x, (int, float)) for x in time_range)):
        raise ValueError('Invalid time range')
    start_time, end_time = float(time_range[0]), float(time_range[1])
    if start_time < 0 or end_time <= start_time:
        raise ValueError('Invalid time range')
    if time_disp not in valid_time_units:
        raise ValueError('Unsupported time unit')
    if time_disp != 's':
        warnings.warn(
            'time_disp is deprecated and has no effect; time_range is always in seconds',
            DeprecationWarning,
            stacklevel=2,
        )
    if grad_disp not in valid_grad_units:
        raise ValueError('Unsupported gradient unit')
    if not isinstance(rate, (int, np.integer)) or rate <= 0:
        raise ValueError('Sample rate must be a positive integer')

    g_factor = [1e-3, 1e3 / self.system.gamma][valid_grad_units.index(grad_disp)]

    # Keep each gradient event separate while collecting it. Interpolating a
    # concatenation of gx/gy/gz events is incorrect because their time ranges
    # overlap; the final waveform must be the sum of all channels at each time.
    events: list = []
    t0 = 0.0
    for block_counter in self.block_events:
        block = self.get_block(block_counter)
        block_dur = self.block_durations[block_counter]
        is_valid = (start_time <= t0 + block_dur) and (t0 <= end_time)
        if is_valid:
            for channel in ['gx', 'gy', 'gz']:
                grad = getattr(block, channel, None)
                if grad is None:
                    continue
                if grad.type == 'grad':
                    times = grad.delay + np.array([0.0, *grad.tt, grad.shape_dur])
                    values = g_factor * np.array([grad.first, *grad.waveform, grad.last], dtype=np.float64)
                else:
                    times = _cumsum(0.0, grad.delay, grad.rise_time, grad.flat_time, grad.fall_time)
                    values = g_factor * grad.amplitude * np.array([0.0, 0.0, 1.0, 1.0, 0.0], dtype=np.float64)
                events.append((times + t0, values))
        t0 += block_dur

    if not events:
        return np.array([], dtype=np.float64)

    t_max = min(float(max(np.max(times) for times, _ in events)), end_time)
    if t_max < start_time:
        return np.array([], dtype=np.float64)
    n_samples = int(np.floor((t_max - start_time) * rate)) + 1
    time_new = start_time + np.arange(n_samples, dtype=np.float64) / rate
    total_waveform = np.zeros(n_samples, dtype=np.float64)
    for times, values in events:
        total_waveform += np.interp(time_new, times, values, left=0.0, right=0.0)

    if play_now and speaker is not None:
        if in_jupyter:
            from IPython.display import display
            display(speaker(total_waveform, rate=rate))
        else:
            speaker(total_waveform, rate=rate)

    if save_dir is not None:
        os.makedirs(save_dir, exist_ok=True)
        out_path = os.path.join(save_dir, save_filename)
        write(out_path, rate=rate, data=total_waveform.astype(np.float32))

    return total_waveform


def _listentoyourpulseq_patch() -> None:
    """Idempotently add the extension methods to :class:`pypulseq.Sequence`."""
    if not hasattr(Sequence, 'listen'):
        Sequence.listen = listen
    if not hasattr(Sequence, 'duration_update'):
        Sequence.duration_update = duration_update
