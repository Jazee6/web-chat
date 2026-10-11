import type { ReactNode } from 'react'
import { FlexRender, type ReactTable, type RowData, type TableFeatures } from '@tanstack/react-table'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** 数据表：列定义与表格状态由调用方的 useTable 管理，这里只按表头组与行模型渲染。外框圆角与 outline 的 Item 一致 */
export function DataTable<TFeatures extends TableFeatures, TData extends RowData, TSelected>({
  table,
}: {
  table: ReactTable<TFeatures, TData, TSelected>
}) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <DataTableHeader table={table} />
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** 加载中的数据表：外框与表头照常，rows 行占位，每行各列放 cells 里对应的占位（与真实单元格同高） */
export function DataTableSkeleton<TFeatures extends TableFeatures, TData extends RowData, TSelected>({
  table,
  rows,
  cells,
}: {
  table: ReactTable<TFeatures, TData, TSelected>
  rows: number
  cells: ReactNode[]
}) {
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table>
        <DataTableHeader table={table} />
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i}>
              {table.getAllLeafColumns().map((column, j) => (
                <TableCell key={column.id}>{cells[j]}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function DataTableHeader<TFeatures extends TableFeatures, TData extends RowData, TSelected>({
  table,
}: {
  table: ReactTable<TFeatures, TData, TSelected>
}) {
  return (
    <TableHeader>
      {table.getHeaderGroups().map((group) => (
        <TableRow key={group.id}>
          {group.headers.map((header) => (
            <TableHead key={header.id}>{header.isPlaceholder ? null : <FlexRender header={header} />}</TableHead>
          ))}
        </TableRow>
      ))}
    </TableHeader>
  )
}
