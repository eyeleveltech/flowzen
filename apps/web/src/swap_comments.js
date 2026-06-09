const fs = require('fs');
const path = require('path');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\app\\(dashboard)\\tasks\\page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const commentsSection = `
                {/* Comments Section */}
                <div className="mt-8 border-t border-[#F3F4F6] pt-6">
                  <h3 className="text-sm font-semibold text-[#111827] mb-4">Comments</h3>
                  
                  {/* Add Comment */}
                  <div className="mb-6 flex gap-3">
                    <div className="flex-1">
                      <textarea
                        value={commentContent}
                        onChange={(e) => setCommentContent(e.target.value)}
                        placeholder="Ask a question or post an update..."
                        className="w-full min-h-[80px] rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm outline-none focus:border-[#111827] transition-all resize-none"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={handleAddComment}
                          disabled={submittingComment || !commentContent.trim()}
                          className="bg-[#111827] text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-black transition-colors disabled:opacity-50"
                        >
                          {submittingComment ? 'Posting...' : 'Post Comment'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Comments List */}
                  <div className="space-y-4">
                    {!selectedTask.comments || selectedTask.comments.length === 0 ? (
                      <p className="text-sm text-[#6B7280] italic text-center py-4">No comments yet. Be the first to start the discussion!</p>
                    ) : (
                      selectedTask.comments.map((comment) => (
                        <div key={comment.id} className="flex gap-3">
                          <div className="h-8 w-8 rounded-full bg-[#F3F4F6] text-[#111827] text-xs font-medium flex items-center justify-center shrink-0 border border-[#E5E7EB]">
                            {comment.author.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 bg-[#FAFAFA] border border-[#E5E7EB] rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-xs text-[#111827]">{comment.author.name}</span>
                              <span className="text-[10px] text-[#9CA3AF]">{new Date(comment.createdAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-[#374151] whitespace-pre-wrap">{comment.content}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                `;

const updateStatusSection = `                {(user?.role !== 'TEAM_MEMBER' || selectedTask.assignee?.id === user?.id) && (
                  <div className="mt-6">
                    <label className="block text-sm font-medium text-[#374151] mb-2">Update Status</label>
                    <div className="flex flex-wrap gap-2">
                      {kanbanCols.map((s) => (
                        <button
                          key={s}
                          onClick={() => { updateTaskStatus(selectedTask.id, s); setSelectedTask({ ...selectedTask, status: s }); }}
                          className={\`rounded-lg px-3 py-1.5 text-xs font-medium transition-all \${selectedTask.status === s ? 'bg-[#111827] text-white' : 'border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB]'}\`}
                        >
                          {kanbanLabels[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}`;

// We know the file has commentsSection followed by updateStatusSection right now
// We replace the combined string with the reversed string.

// To be safe, let's remove commentsSection from its current location, and append it AFTER updateStatusSection.
let newContent = content.replace(commentsSection, '');
newContent = newContent.replace(updateStatusSection, updateStatusSection + commentsSection);

fs.writeFileSync(file, newContent, 'utf-8');
console.log('Swapped comments and update status.');
