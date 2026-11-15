import { create } from 'zustand'

export const useGlobalSearch = create<{ open: boolean }>(() => ({ open: false }))
export const openGlobalSearch = () => useGlobalSearch.setState({ open: true })
export const closeGlobalSearch = () => useGlobalSearch.setState({ open: false })
