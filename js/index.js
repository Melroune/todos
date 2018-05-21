import api from './api.js'
import { createTodoElement, noTodosContainer } from './components/todo.js'

const formMessage = document.getElementById('add-todo-message')

const render = todos => {
  // sort
  todos.sort((a, b) => b.stars.length - a.stars.length)

  const todosElement = document.getElementById('todos')

  todosElement.innerHTML = todos.map(createTodoElement).join('') || noTodosContainer

  const voteButtons = Array.from(document.getElementsByClassName('button-star'))
  voteButtons.forEach(b => {
    b.addEventListener('click', async e => {
      e.preventDefault()

      const todoId = e.target.dataset.id
      api.get(`/todos/vote/${todoId}`)
        .then(res => !res.error && api.get('/todos').then(render)) // refresh
    })
  })
}

const handleResponse = res => {
  if (formMessage) {
    formMessage.textContent = res.error || 'all good'
  }

  if (res.error) return

  const todos = res
  render(todos)
}

const form = document.getElementById('form-todos-add')

form.addEventListener('submit', e => {
  e.preventDefault()
  formMessage.textContent = ''

  const formData = new FormData(e.target)

  api.post('/todos', formData).then(handleResponse)
})

api.get('/todos').then(render)