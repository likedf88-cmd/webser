import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { Spinner } from '../components/ui'
import PostCard from '../components/PostCard'

export default function PostPage() {
  const { id } = useParams()
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/posts/' + id).then(d => setPost(d.post)).catch(e => setError(e.message))
  }, [id])

  if (error) return <div className="page"><div className="center-pad"><h3>{error}</h3><Link className="btn btn-primary" to="/">Back to feed</Link></div></div>
  if (!post) return <div className="page"><Spinner label="Loading post…" /></div>

  return (
    <div className="page">
      <Link to="/" className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← Back</Link>
      <PostCard post={post} />
    </div>
  )
}
