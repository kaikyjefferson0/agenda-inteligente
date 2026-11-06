MINUTES_PER_DAY = 24 * 60

# The documents define the minimums. These maximums keep values within what the
# rules can use and within the database's integer range.
MAX_MIN_ADVANCE_MINUTES = 365 * MINUTES_PER_DAY
MAX_ADVANCE_DAYS = 365
MAX_CHANGE_DEADLINE_MINUTES = 30 * MINUTES_PER_DAY
MAX_SERVICE_DURATION_MINUTES = MINUTES_PER_DAY
MAX_SERVICE_PREPARATION_MINUTES = MINUTES_PER_DAY
MAX_SERVICE_PRICE_CENTS = 100_000_000


def is_advance_window_valid(min_advance_minutes: int, max_advance_days: int) -> bool:
    """RN05: a minimum above the maximum would leave no bookable time at all."""
    return min_advance_minutes <= max_advance_days * MINUTES_PER_DAY
