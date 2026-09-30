import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

type MusicPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
};

export default function MusicPagination({
  page,
  pageSize,
  total,
  itemLabel,
  onPageChange,
}: MusicPaginationProps) {
  const pageCount = Math.ceil(total / pageSize);
  const firstPage = Math.max(0, Math.min(page - 2, pageCount - 5));
  const pages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => firstPage + index,
  );
  const start = total ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <nav className="music-pagination" aria-label={`${itemLabel} pagination`}>
      <span className="music-pagination-count">
        {start}-{end} of {total}
      </span>
      <button
        type="button"
        title="Previous page"
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeftIcon fontSize="small" />
      </button>
      {pages.map((pageNumber) => (
        <button
          type="button"
          key={pageNumber}
          aria-label={`Page ${pageNumber + 1}`}
          aria-current={page === pageNumber ? 'page' : undefined}
          className={page === pageNumber ? 'active' : ''}
          onClick={() => onPageChange(pageNumber)}
        >
          {pageNumber + 1}
        </button>
      ))}
      <button
        type="button"
        title="Next page"
        aria-label="Next page"
        disabled={page + 1 >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRightIcon fontSize="small" />
      </button>
    </nav>
  );
}
