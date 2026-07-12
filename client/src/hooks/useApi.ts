import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'error'; data: null; error: ApiError }
  | { status: 'success'; data: T; error: null };

/**
 * Quản lý 4 trạng thái màn: loading (skeleton) · error · success (rỗng vs có dữ liệu do UI quyết).
 * `deps` đổi => tự nạp lại. `reload()` để thử lại thủ công.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & {
  reload: () => void;
} {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  // fetcher đổi mỗi render nên bám vào deps do người gọi khai báo (chủ ý).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
    run()
      .then((data) => {
        if (alive) setState({ status: 'success', data, error: null });
      })
      .catch((err) => {
        if (!alive) return;
        const apiErr =
          err instanceof ApiError ? err : new ApiError(0, 'Có lỗi xảy ra, vui lòng thử lại.');
        setState({ status: 'error', data: null, error: apiErr });
      });
    return () => {
      alive = false;
    };
  }, [run, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
